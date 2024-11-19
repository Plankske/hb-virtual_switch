import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { HomebridgeVirtualSwitchesPlatform } from './platform';

// Define interface for timer info
interface TimerInfo {
  targetTime: number;
  duration: number;
}

export class HomebridgeVirtualSwitchesAccessory {
  private service!: Service;
  private switchState = false;
  private timer: NodeJS.Timeout | undefined;
  private timerEndTime: number | undefined;
  private useLogFile: boolean;
  
  constructor(
    private readonly platform: HomebridgeVirtualSwitchesPlatform,
    public readonly accessory: PlatformAccessory,
  ) {
    this.useLogFile = accessory.context.device.UseLogFile;

    // Set up accessory information
    this.setupAccessoryInformation();

    // Attempt to initialize the switch service
    this.initializeService();

    // Initialize state
    this.initializeState();
  }

  private initializeService() {
    // Assign `service` outside of try-catch for safer error handling
    this.service = this.accessory.getService(this.platform.Service.Switch) || 
                   this.accessory.addService(this.platform.Service.Switch);

    try {
      // Only wrap code that might throw an error in try-catch
      this.service.setCharacteristic(this.platform.Characteristic.Name, this.accessory.context.device.Name);

      this.service.getCharacteristic(this.platform.Characteristic.On)
        .onSet(this.setOn.bind(this))
        .onGet(this.getOn.bind(this));
    } catch (error) {
      if (error instanceof Error) {
        this.platform.log.error(`Failed to initialize switch characteristics: ${error.message}`);
      } else {
        this.platform.log.error('Failed to initialize switch characteristics: Unknown error occurred');
      }
    }
  }


  private setupAccessoryInformation() {
    const accessoryInformationService = this.accessory.getService(this.platform.Service.AccessoryInformation);
    if (accessoryInformationService) {
      accessoryInformationService
        .setCharacteristic(this.platform.Characteristic.Manufacturer, 'HomebridgeVirtualSwitchesPlatform')
        .setCharacteristic(this.platform.Characteristic.Model, 'HomebridgeVirtualSwitchAccessory-Switch')
        .setCharacteristic(this.platform.Characteristic.Name, this.accessory.context.device.Name)
        .setCharacteristic(this.platform.Characteristic.SerialNumber, 
          `HomebridgeVirtualSwitchAccessory-${this.accessory.context.device.Name}`)
        .setCharacteristic(this.platform.Characteristic.FirmwareRevision, '0.0.0');
    }
  }

  private initializeState() {
    const device = this.accessory.context.device;
    
    // Check if UseCustomTime is selected with all custom time fields as 0
    const hasZeroCustomTime = 
      device.TimeDays === 0 &&
      device.TimeHours === 0 &&
      device.TimeMinutes === 0 &&
      device.TimeSeconds === 0;
      
    if (!device.SwitchStayOn && device.UseCustomTime && hasZeroCustomTime) {
      throw new Error(`Switch "${device.Name}" cannot be initialized: "Set timer in days/hours/..." is selected and all time fields are 0 in switch config.`);
    }

    // Check if Time is 0 when UseCustomTime is not selected
    if (!device.SwitchStayOn && !device.UseCustomTime && device.Time === 0) {
      this.platform.log.info(`SwitchStayon "${device.SwitchStayOn}"`);
      this.platform.log.info(`UseCustomTime: "${device.UseCustomTime}"`);
      throw new Error(`Switch "${device.Name}" cannot be initialized:"Timer (in ms)" is 0 and "Set timer in day/hours/..." is not selected in switch config.`);
    }
    
    

    // Check for persistent timer state
    if (device.TimerPersistent && device.timerState) {
      const { targetTime, isRunning } = device.timerState;
      if (isRunning) {
        if (this.platform.hasReachedTargetTime(targetTime)) {
          // Timer has expired while system was off
          this.switchState = device.NormallyClosed;
          this.platform.clearTimerState(device.Name);
          this.platform.log.info(`Switch "${device.Name}" turned ${device.NormallyClosed ? 'on' : 'off'} as persistent timer expired during downtime.`);
        } else {
          // Resume timer and set correct state
          const remainingTime = targetTime - Date.now();
          this.switchState = !device.NormallyClosed; // Set to triggered state
          this.startOffTimer({
            targetTime: targetTime,
            duration: remainingTime,
          });
          this.platform.log.info(
            `Resuming persistent timer for "${device.Name}" with ${remainingTime}ms remaining. Switch state set to ${this.switchState ? 'on' : 'off'}.`,
          );
        }
      }
    
    // Initialize switch state
    } else if (device.RememberState && device.lastState !== null) {
      this.switchState = device.lastState;
    } else {
      this.switchState = device.NormallyClosed;
    }


    this.updateHomeKitState();
    
    const homeKitState = this.switchState;
    this.platform.log.info(
      `Switch "${device.Name}" initialized as ${homeKitState ? 'on' : 'off'} ` +
      `(Normally ${device.NormallyClosed ? 'Closed' : 'Open'})`,
    );
  }

  async setOn(value: CharacteristicValue) {
    const device = this.accessory.context.device;
    const newHomeKitState = value as boolean;

    if (!device.NormallyClosed) {
      this.switchState = device.NormallyClosed ? !newHomeKitState : newHomeKitState;
    } else {
      this.switchState = newHomeKitState;
    }

    if (this.switchState !== device.NormallyClosed) {
      this.platform.log.info(`Switch "${device.Name}" turned ${device.NormallyClosed ? 'off' : 'on'}.`);
      if (!device.SwitchStayOn) {
        const timerInfo = this.platform.calculateTargetTime(device);
        this.startOffTimer(timerInfo);
      }
    } else {
      this.platform.log.info(`Switch "${device.Name}" turned ${device.NormallyClosed ? 'on' : 'off'}.`);
      this.clearTimer();
    }

    if (device.RememberState) {
      this.platform.saveSwitchState(device.Name, this.switchState);
    }
  }

  async getOn(): Promise<CharacteristicValue> {
    return this.switchState;
  }

  public triggerSwitch() {
    const device = this.accessory.context.device;
    const isTriggered = this.switchState !== device.NormallyClosed;

    // Handle stateful switches with log file monitoring
    if (isTriggered && device.SwitchStayOn && this.useLogFile) {
      this.platform.log.debug(`DEBUG: "${device.Name}" Ignoring trigger due to keyword (stateful switch).`);
      return;
    }

    // Handle non-stateful switches with active timers
    if (isTriggered && !device.SwitchStayOn && this.timer && this.timerEndTime && Date.now() < this.timerEndTime) {
      this.platform.log.debug(`DEBUG: "${device.Name}" Ignoring trigger as the timer is still active.`);
      return;
    }

    // Toggle switch state
    this.switchState = !this.switchState;
    this.updateHomeKitState();
  
    if (this.switchState !== device.NormallyClosed) {
      this.platform.log.info(`Switch "${device.Name}" turned ${device.NormallyClosed ? 'off' : 'on'}.`);
      if (!device.SwitchStayOn) {
        if (device.TimerPersistent) {
          const timerInfo = this.platform.calculateTargetTime(device);
          this.startOffTimer(timerInfo);
        } else {
          this.startOffTimer({ targetTime: 0, duration: device.Time });
        }
      }
    } else {
      this.platform.log.info(`Switch "${device.Name}" turned ${device.NormallyClosed ? 'on' : 'off'}.`);
      this.clearTimer();
    }

    // Save state if required
    if (device.RememberState) {
      this.platform.saveSwitchState(device.Name, this.switchState);
    }
  }

  private startOffTimer(timerInfo: TimerInfo) {
    const device = this.accessory.context.device;
    this.clearTimer();
  
    this.timerEndTime = timerInfo.targetTime || (Date.now() + timerInfo.duration);
  
    // Log timer information
    if (device.TimerPersistent) {
      this.platform.log.info(
        `Switch "${device.Name}" will turn ${device.NormallyClosed ? 'on' : 'off'} at ${new Date(this.timerEndTime).toLocaleString()}`,
      );
      // Save persistent timer state
      this.platform.saveTimerState(device.Name, this.timerEndTime, true);
    } else {
      this.platform.log.info(
        `Switch "${device.Name}" will turn ${device.NormallyClosed ? 'on' : 'off'} after ${timerInfo.duration} milliseconds.`,
      );
    }
  
    this.timer = setTimeout(() => {
      this.switchState = device.NormallyClosed;
      this.updateHomeKitState();
  
      if (device.TimerPersistent) {
        this.platform.clearTimerState(device.Name);
      }
  
      const homeKitState = this.switchState;
      this.platform.log.info(`Switch "${device.Name}" turned ${homeKitState ? 'on' : 'off'} automatically after timer expired.`);
    }, timerInfo.duration);
  }

  private clearTimer() {
    const device = this.accessory.context.device;
    
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.timerEndTime = undefined;
      
      if (device.TimerPersistent) {
        this.platform.clearTimerState(device.Name);
      }
    }
  }

  private updateHomeKitState() {
    const homeKitState = this.switchState;

    const service = this.accessory.getService(this.platform.Service.Switch);
    if (service) {
      service.updateCharacteristic(this.platform.Characteristic.On, homeKitState);
    } else {
      this.platform.log.error(`ERROR: Failed to find the switch service for "${this.accessory.displayName}".`);
    }
  }
}