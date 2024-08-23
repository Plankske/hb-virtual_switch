import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { HomebridgeVirtualSwitchesPlatform } from './platform';

export class HomebridgeVirtualSwitchesAccessory {
  private service: Service;
  private switchState = false;
  private timer: NodeJS.Timeout | undefined;
  private timerEndTime: number | undefined;
  private useLogFile: boolean;

  constructor(
    private readonly platform: HomebridgeVirtualSwitchesPlatform,
    public readonly accessory: PlatformAccessory,
  ) {
    this.useLogFile = accessory.context.device.UseLogFile;
    // Log tp see the accessory context
    this.platform.log.debug('Accessory context:', JSON.stringify(this.accessory.context));

    this.service = this.accessory.getService(this.platform.Service.Switch) || this.accessory.addService(this.platform.Service.Switch);
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.Name);

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));
  }

  async setOn(value: CharacteristicValue) {
    const newState = value as boolean;
    const device = this.accessory.context.device;

    if (newState === this.switchState) {
      return;
    }

    this.switchState = newState;

    if (this.switchState) {
      this.platform.log.info(`Switch "${device.Name}" turned on.`);
      if (!device.SwitchStayOn) {
        this.startOffTimer();
      }
    } else {
      this.platform.log.info(`Switch "${device.Name}" turned off (manually).`);
      this.clearTimer();
    }
  }

  async getOn(): Promise<CharacteristicValue> {
    return this.switchState;
  }

  public triggerSwitch() {
    const device = this.accessory.context.device;

    if (this.switchState) {
      if (!device.SwitchStayOn) {
        this.platform.log.info(`Switch "${device.Name}" is already on. Resetting the timer.`);
        this.resetOffTimer();
      }
    } else {
      this.platform.log.info(`Triggering switch "${device.Name}" to turn on.`);
      this.switchState = true;
      this.service.updateCharacteristic(this.platform.Characteristic.On, true);
      if (!device.SwitchStayOn) {
        this.startOffTimer();
      }
    }
  }

  private startOffTimer() {
    const device = this.accessory.context.device;
    this.clearTimer();

    this.platform.log.info(`Switch "${device.Name}" will turn off after ${device.Time} milliseconds.`);
    this.timerEndTime = Date.now() + device.Time;

    this.timer = setTimeout(() => {
      this.switchState = false;
      this.service.updateCharacteristic(this.platform.Characteristic.On, false);
      this.platform.log.info(`Switch "${device.Name}" turned off automatically after timer expired.`);
    }, device.Time);
  }

  private resetOffTimer() {
    if (this.timer && this.timerEndTime) {
      const remainingTime = this.timerEndTime - Date.now();
      this.clearTimer();

      const device = this.accessory.context.device;
      this.platform.log.info(`Switch "${device.Name}" timer reset. Will turn off after ${remainingTime} milliseconds.`);
      
      this.timerEndTime = Date.now() + remainingTime;
      this.timer = setTimeout(() => {
        this.switchState = false;
        this.service.updateCharacteristic(this.platform.Characteristic.On, false);
        this.platform.log.info(`Switch "${device.Name}" turned off automatically after reset timer expired.`);
      }, remainingTime);
    }
  }

  private clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.timerEndTime = undefined;
    }
  }
}
