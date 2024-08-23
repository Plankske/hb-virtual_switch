import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { HomebridgeVirtualSwitchesAccessory } from './platformAccessory.js';
import { spawn } from 'child_process';
import stripAnsi from 'strip-ansi';

// Define an interface for device configuration
interface DeviceConfig {
  Name: string;
  SwitchStayOn: boolean;
  Time: number;
  UseLogFile: boolean;
  LogFilePath: string;
  Keywords: string[];
  EnableStartupDelay: boolean;
  StartupDelay: number;
}

export class HomebridgeVirtualSwitchesPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: PlatformAccessory[] = [];
  private accessoryInstances: Map<string, HomebridgeVirtualSwitchesAccessory> = new Map();
  private tailProcesses: Map<string, ReturnType<typeof spawn>> = new Map();

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

    this.log.debug('Finished initializing platform.');

    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      this.loadDependencies().then(() => {
        this.discoverDevices();
      }).catch((error) => {
        this.log.error('Failed to load dependencies:', error);
      });  
    });
  }

  private async loadDependencies() {
    try {
      const childProcess = await import('child_process');
      this.spawn = childProcess.spawn;
    } catch (error) {
      this.log.error('Failed to load child_process module:', error);
      throw error;
    }

    try {
      const stripAnsiModule = await import('strip-ansi');
      this.stripAnsi = stripAnsiModule.default;
    } catch (error) {
      this.log.error('Failed to load strip-ansi module:', error);
      throw error;
    }
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  discoverDevices() {
    // `this.config.devices` is an array of device configurations
    const devices: DeviceConfig[] = Array.isArray(this.config.devices) ? this.config.devices : [];

    for (const deviceConfig of devices) {
      const device = {
        Name: deviceConfig.Name,
        SwitchStayOn: deviceConfig.SwitchStayOn,
        Time: deviceConfig.Time,
        UseLogFile: deviceConfig.UseLogFile,
        LogFilePath: deviceConfig.LogFilePath,
        Keywords: Array.isArray(deviceConfig.Keywords) ? deviceConfig.Keywords : [],
        EnableStartupDelay: deviceConfig.EnableStartupDelay,
        StartupDelay: deviceConfig.StartupDelay,
      };
      
      //this.log.debug('Device config:', JSON.stringify(device));
      
      const uuid = this.api.hap.uuid.generate(device.Name);
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
        existingAccessory.context.device = device;
        this.api.updatePlatformAccessories([existingAccessory]);
        const accessoryInstance = new HomebridgeVirtualSwitchesAccessory(this, existingAccessory);
        this.accessoryInstances.set(uuid, accessoryInstance);
      } else {
        this.log.info('Adding new accessory:', device.Name);
        const accessory = new this.api.platformAccessory(device.Name, uuid);
        accessory.context.device = device;
        const accessoryInstance = new HomebridgeVirtualSwitchesAccessory(this, accessory);
        this.accessoryInstances.set(uuid, accessoryInstance);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      // Start log monitoring with the specified delay
      if (device.UseLogFile) {
        const startupDelay = device.EnableStartupDelay ? device.StartupDelay || 10000 : 0;
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
      if (!this.isPluginLogMessage(line)) {
        this.checkKeywords(line, uuid);
      }
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
    if (this.isPluginLogMessage(line)) {
      return;

    }
    //this.log.debug(`Checking keywords for UUID: ${uuid}`); // Log UUID

    const accessoryInstance = this.accessoryInstances.get(uuid);
    if (!accessoryInstance) {
      //this.log.error(`No accessory instance found for UUID ${uuid}`);
      return;
    }

    const device = accessoryInstance.accessory.context.device;
    if (!device) {
      //this.log.error(`Device configuration is missing for UUID ${uuid}`);
      return;
    }

    const cleanedLine = this.escapeSpecialChars(this.removeAnsiCodes(line).toLowerCase());
    const processedKeywords = device.Keywords.map((keyword: string) => this.escapeSpecialChars(this.removeAnsiCodes(keyword).toLowerCase()));

    if (processedKeywords.some((keyword: string) => cleanedLine.includes(keyword))) {
    //  this.log.debug(`Keyword match found for switch "${device.Name}"`);
      accessoryInstance.triggerSwitch();
    //} else {
    //  this.log.debug(`No keyword match found for switch "${device.Name}"`);
    }
  }


  // Helper method to check if the line is a plugin log message (needed when debugging)
  private isPluginLogMessage(line: string): boolean {
    return line.includes('homebridge-virtual-switch') || line.includes('HomebridgeVirtualSwitches');
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
}