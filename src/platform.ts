import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { HomebridgeVirtualSwitchesAccessory } from './platformAccessory.js';
import { spawn } from 'child_process';
import stripAnsi from 'strip-ansi';
import fs from 'fs';
import path from 'path';

// Define an interface for device configuration
interface DeviceConfig {
  Name: string;
  NormallyClosed: boolean;
  SwitchStayOn: boolean;
  Time: number;
  UseCustomTime: boolean;
  TimeDays: number;
  TimeHours: number;
  TimeMinutes: number;
  TimeSeconds: number;
  TimerPersistent: boolean
  UseLogFile: boolean;
  LogFilePath: string;
  Keywords: string[];
  EnableStartupDelay: boolean;
  UseCustomStartupDelay: boolean;
  StartupDelay: number;
  StartupDelayDays: number
  StartupDelayHours: number;
  StartupDelayMinutes: number;
  StartupDelaySeconds: number;
  RememberState: boolean;
}

// Define an interface for timer state
interface TimerState {
  targetTime: number;
  isRunning: boolean;
}

export class HomebridgeVirtualSwitchesPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: PlatformAccessory[] = [];
  private accessoryInstances: Map<string, HomebridgeVirtualSwitchesAccessory> = new Map();
  private tailProcesses: Map<string, ReturnType<typeof spawn>> = new Map();
  private timerStates: Map<string, TimerState> = new Map();

  // Declare the properties
  private spawn: typeof import('child_process').spawn | undefined;
  private stripAnsi: ((text: string) => string) | undefined;
  
  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.log.debug('DEBUG: Finished initializing platform.');

    this.api.on('didFinishLaunching', () => {
      this.log.debug('DEBUG: Executed didFinishLaunching callback');
      this.loadDependencies().then(() => {
        this.discoverDevices();
      }).catch((error) => {
        this.log.error('ERROR: Failed to load dependencies:', error);
      });  
    });
  }

  private async loadDependencies() {
    try {
      const childProcess = await import('child_process');
      this.spawn = childProcess.spawn;
    } catch (error) {
      this.log.error('ERROR: Failed to load child_process module:', error);
      throw error;
    }

    try {
      const stripAnsiModule = await import('strip-ansi');
      this.stripAnsi = stripAnsiModule.default;
    } catch (error) {
      this.log.error('ERROR: Failed to load strip-ansi module:', error);
      throw error;
    }
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  discoverDevices() {
    // Get configured devices from config
    const devices: DeviceConfig[] = Array.isArray(this.config.devices) ? this.config.devices : [];

    // Create a set of configured device UUIDs for quick lookup
    const configuredUUIDs = new Set(
      devices.map(device => this.api.hap.uuid.generate(device.Name)),
    );

    // First, remove accessories that are no longer in the config
    const accessoriesToRemove = this.accessories.filter(accessory => 
      !configuredUUIDs.has(accessory.UUID),
    );

    if (accessoriesToRemove.length >0) {
      this.log.info(`Removing ${accessoriesToRemove.length} unconfigured accessories`);

      for (const accessory of accessoriesToRemove) {
        const uuid = accessory.UUID;
        
        // Stop any running tail processes
        if (this.tailProcesses.has(uuid)) {
          const tailProcess = this.tailProcesses.get(uuid);
          if (tailProcess) {
            tailProcess.kill();
            this.tailProcesses.delete(uuid);
          }
        }
        
        // Clean up timer states
        this.clearTimerState(accessory.displayName);
        
        // Remove from accessory instances
        this.accessoryInstances.delete(uuid);
        
        // Remove the index from our accessories array
        const index = this.accessories.indexOf(accessory);
        if (index > -1) {
          this.accessories.splice(index, 1);
        }
      }
      
      // Unregister from HomeKit
      this.api.unregisterPlatformAccessories(
        PLUGIN_NAME,
        PLATFORM_NAME,
        accessoriesToRemove,
      );
    }

    for (const deviceConfig of devices) {
      if (!deviceConfig.Name || deviceConfig.Name.trim() === '') {
        this.log.info('ERROR: Switch with missing "Switch Name" found in this Plugin Config.');
        this.log.info('ERROR: Give it a "Switch Name" in your "Homebridge Virtual Switches Plugin Config".');
        //continue; // Skip this device but continue processing others
      }

      // Ensure all properties are passed through
      const device = {
        ...deviceConfig,
        Keywords: Array.isArray(deviceConfig.Keywords) ? deviceConfig.Keywords : [], // Only override Keywords to ensure it's an array
      };
     
      this.log.debug('DEBUG: Device config:', JSON.stringify(device));
      
      const uuid = this.api.hap.uuid.generate(device.Name);
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      // Load last switch state if RememberSwitchSate = true
      let lastState: boolean | null = null;
      if (deviceConfig.RememberState) {
        lastState = this.loadSwitchState(device.Name);
      }

      // Load persistent timer state if TimerPersistant = true
      let timerState: TimerState | null = null;
      if (deviceConfig.TimerPersistent) {
        timerState = this.loadTimerState(device.Name);
        if (timerState && timerState.isRunning) {
          this.log.debug(`DEBUG: Loaded persistent timer state for "${device.Name}"`);
        }
      }

      if (existingAccessory) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
        existingAccessory.context.device = { ...device, lastState, timerState };
        this.api.updatePlatformAccessories([existingAccessory]);
        const accessoryInstance = new HomebridgeVirtualSwitchesAccessory(this, existingAccessory);
        this.accessoryInstances.set(uuid, accessoryInstance);
      } else {
        this.log.info('Adding new accessory:', device.Name);
        const accessory = new this.api.platformAccessory(device.Name, uuid);
        accessory.context.device = { ...device, lastState, timerState };
        const accessoryInstance = new HomebridgeVirtualSwitchesAccessory(this, accessory);
        this.accessoryInstances.set(uuid, accessoryInstance);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      // Start log monitoring with the specified delay after startup
      if (device.UseLogFile) {
        let startupDelay =0;

        if (device.UseCustomStartupDelay) {
          if (device.UseCustomStartupDelay) {
            // Convert days, hours, minutes and seconds to milliseconds
            startupDelay = (
              ((((device.StartupDelayDays * 24 + device.StartupDelayHours) * 60) + device.StartupDelayMinutes) * 60 + device.StartupDelaySeconds) * 1000);
            const timeStr = `${device.StartupDelayDays}d ${device.StartupDelayHours}h ${device.StartupDelayMinutes}m ${device.StartupDelaySeconds}s`;
            this.log.debug(`DEBUG: Using startup delay set in day/hr/min/sec for "${device.Name}": ${startupDelay}ms (${timeStr})`);
          } else {
            // Use the default startupDelay
            startupDelay = device.StartupDelay;
            this.log.debug(`DEBUG: Using startup delay set in milliseconds for "${device.Name}": ${startupDelay}ms`);
          }
        }

        setTimeout(() => {
          this.startLogMonitoring(device, uuid);
        }, startupDelay);
        
      }
    }
  }

  startLogMonitoring(device: DeviceConfig, uuid: string) {
    if (!this.spawn) {
      this.log.error('Cannot start log monitoring: child_process module not loaded');
      return;
    }

    const logFilePath = device.LogFilePath || '/var/lib/homebridge/homebridge.log';
    this.log.info(`Starting to monitor log file at: ${logFilePath} for switch "${device.Name}"`);

    // Use tail -f to monitor the log file
    const tail = spawn('tail', ['-f', logFilePath]);

    tail.stdout.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      this.checkKeywords(line, uuid);
      //if (!this.isPluginLogMessage(line)) {
      //  this.checkKeywords(line, uuid);
      //}
    });

    tail.stderr.on('data', (data: Buffer) => {
      this.log.error(`Error from tail process for "${device.Name}": ${data.toString()}`);
    });

    tail.on('close', (code) => {
      this.log.info(`Tail process for "${device.Name}" exited with code ${code}`);
    });

    this.tailProcesses.set(uuid, tail);
  }

  private checkKeywords(line: string, uuid: string) {
    
    const accessoryInstance = this.accessoryInstances.get(uuid);
    if (!accessoryInstance) {
      return;
    }

    const device = accessoryInstance.accessory.context.device;
    if (!device) {
      return;
    }
    
    if (this.isPluginLogMessage(line,device)) {
      return;
    }
    const cleanedLine = this.escapeSpecialChars(this.removeAnsiCodes(line).toLowerCase());
    const processedKeywords = device.Keywords.map((keyword: string) => 
      this.escapeSpecialChars(this.removeAnsiCodes(keyword).toLowerCase()));

    processedKeywords.some((keyword: string) => {
      if (cleanedLine.includes(keyword)) {
        
        this.log.debug(`DEBUG: Keyword match ("${keyword}") found for switch "${device.Name}"`);
        //const foundKeyword = keyword;
        //this.log.debug(`DEBUG: Keyword match ("${foundKeyword}") found for switch "${device.Name}"`);
        accessoryInstance.triggerSwitch();
        return true;
      }
      return false;
    });
  }
  
  // Helper method to check if the line is generated by this plugin and by  a switch that monitors a log file (needed when debugging)
  private isPluginLogMessage(line: string, device: DeviceConfig): boolean {

    // Check if the line is a debug or error message from this plugin
    if ((line.includes('DEBUG:') || line.includes('ERROR: ')) && 
       (line.includes('homebridge-virtual-switch') || line.includes('HomebridgeVirtualSwitches'))) {
      return true; // Exclude debug and error messages from checking for keywords
    }
   
    if (!device.UseLogFile) { 
      return false; // Don't exclude any lines for switches not using log file monitoring
    }
    
    // Exclude lines that contain both the plugin name and the specific switch name
    return (line.includes('homebridge-virtual-switch') || line.includes('HomebridgeVirtualSwitches')) 
           && line.includes(device.Name); 
  }


  // Helper method to escape special characters in keywords
  private escapeSpecialChars(keyword: string): string {
    return keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
  }

  //Helper method to remove ANSI escape codes from a string
  private removeAnsiCodes(text: string): string {
    if (!this.stripAnsi) {
      this.log.warn('strip-ansi module not loaded, ANSI codes will not be removed');
      return text;
    }
    return stripAnsi(text);
  }

  // Add this helper method to save the state of a switch
  public saveSwitchState(name: string, state: boolean) {
    const stateFilePath = path.join(this.api.user.storagePath(), `${name}_state.json`);
    fs.writeFileSync(stateFilePath, JSON.stringify({ state }), 'utf8');
  }

  // Add this helper method to load the state of a switch
  private loadSwitchState(name: string): boolean | null {
    try {
      const stateFilePath = path.join(this.api.user.storagePath(), `${name}_state.json`);
      if (fs.existsSync(stateFilePath)) {
        const data = fs.readFileSync(stateFilePath, 'utf8');
        const parsed = JSON.parse(data);
        return parsed.state;
      }
    } catch (error) {
      this.log.error(`ERROR: Failed to load state for switch "${name}":`, error);
    }
    return null;
  }

  // Add new methods for persistent timer management
  public saveTimerState(name: string, targetTime: number, isRunning: boolean) {
    const timerStatePath = path.join(this.api.user.storagePath(), `${name}_timer.json`);
    fs.writeFileSync(timerStatePath, JSON.stringify({ targetTime, isRunning }), 'utf8');
    this.timerStates.set(name, { targetTime, isRunning });
  }

  public loadTimerState(name: string): TimerState | null {
    try {
      const timerStatePath = path.join(this.api.user.storagePath(), `${name}_timer.json`);
      if (fs.existsSync(timerStatePath)) {
        const data = fs.readFileSync(timerStatePath, 'utf8');
        const parsed = JSON.parse(data);
        this.timerStates.set(name, parsed);
        return parsed;
      }
    } catch (error) {
      this.log.error(`ERROR: Failed to load timer state for switch "${name}":`, error);
    }
    return null;
  }

  public clearTimerState(name: string) {
    const timerStatePath = path.join(this.api.user.storagePath(), `${name}_timer.json`);
    if (fs.existsSync(timerStatePath)) {
      fs.unlinkSync(timerStatePath);
    }
    this.timerStates.delete(name);
  }


  // Helper to calculate the target time of Persistent switches
  public calculateTargetTime(device: DeviceConfig): { targetTime: number; duration: number } {
    const now = Date.now();
    
    if (device.TimerPersistent) {
      if (device.UseCustomTime) {
        // Convert days, hours, minutes, and seconds to milliseconds
        const milliseconds = (
          ((((device.TimeDays * 24 + device.TimeHours) * 60) + 
          device.TimeMinutes) * 60 + device.TimeSeconds) * 1000
        );
        const targetTime = now + milliseconds;
        const targetDate = new Date(targetTime);
        this.log.debug(
          `DEBUG: Persistent timer for "${device.Name}" will run until: ${targetDate.toLocaleString()}`,
        );
        return { targetTime, duration: milliseconds };
      } else {
        // Use the simple Time value (already in milliseconds)
        const targetTime = now + device.Time;
        const targetDate = new Date(targetTime);
        this.log.debug(
          `DEBUG: Persistent timer for "${device.Name}" will run until: ${targetDate.toLocaleString()}`,
        );
        return { targetTime, duration: device.Time };
      }
    } else {
      // Handle non-persistent switches
      if (device.UseCustomTime) {
        // Convert days, hours, minutes, and seconds to milliseconds
        const milliseconds = (
          ((((device.TimeDays * 24 + device.TimeHours) * 60) + 
          device.TimeMinutes) * 60 + device.TimeSeconds) * 1000
        );
        const targetTime = 0; // Non-persistent switches don't need a target time
        const targetDate = new Date(now + milliseconds);
        this.log.debug(
          `DEBUG: Non-persistent timer for "${device.Name}" will run for ${milliseconds}ms until: ${targetDate.toLocaleString()}`,
        );
        return { targetTime, duration: milliseconds };
      } else {
        // Use the simple Time value (already in milliseconds)
        const targetTime = 0; // Non-persistent switches don't need a target time
        const duration = device.Time;
        const targetDate = new Date(now + duration);
        this.log.debug(
          `DEBUG: Non-persistent timer for "${device.Name}" will run for ${duration}ms until: ${targetDate.toLocaleString()}`,
        );
        return { targetTime, duration };
      }
    }
  }
  
  // Check if target time has been reached
  public hasReachedTargetTime(targetTime: number): boolean {
    if (targetTime === 0) {
      return false;
    }
    return Date.now() >= targetTime;
  }

}