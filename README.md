<p align="center">
<img src="https://github.com/homebridge/branding/raw/latest/logos/homebridge-wordmark-logo-vertical.png" width="150">
</p>

<span align = "center">

# Homebridge Virtual Switches
</p>

<span align = "left">

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

<p align = "center">
<img src="https://github.com/Plankske/hb-virtual-switch/blob/latest/image.png" width="100"/>
</p>


> **Homebridge v2.0 Information**  
> This plugin is Homebridge v2.0 ready.

---
<span align = "left">

**Homebridge-Virtual Switches** is a plugin that creates a variety of virtual `stateful` or `timer controlled` switches.

`Stateful` switches have the option of being:
- `normally closed` (initial state = ON). Default is normally open (i.e. initial state = OFF),
- triggered manually (or via Homekit automations) or through `log file monitoring`. When certain keywords or keyphrases appear in the Homebridge log file, the switch will be triggered,
- when the stateful switch is controled by `log file monitoring`, a `StartupDelay` to delay the start of the log file monitoring until Homebridge is fully initialized,
- when the stateful switch is not triggered by `log file monitoring`, the switch can be set to `restart in its last known state` when Homebridge restarts.

`Timer controlled` switches have the option of being:
- `normally closed` (initial state = ON). Default is normally open (i.e. initial state = OFF),
- triggered manually (or via Homekit automations) or through `log file monitoring`. When certain keywords or keyphrases appear in the Homebridge log file, the switch will be triggered,
- when the stateful switch is controled by `log file monitoring`, a `StartupDelay` to delay the start of the log file monitoring until Homebridge is fully initialized,
- `persistent`. When a timer is running and Homebridge shuts down, the switch is be restored in its last know state and timer will resume and switch at the originally scheduled end time. 

**Note on `log monitoring`:**

When set, the plugin monitors any log file (defaults to the Homebridge log file) for specific keywords or key phrases. When a keyword is detected, a virtual switch (normally open or normally closed, stateful or not) is triggered. This can be helpful in advanced HomeKit automations.

*Example:*  
If a plugin loses API authentication, a log message alerts you. This log message can be used as a key phrase to trigger a virtual switch, allowing HomeKit automations to send alerts (e.g., Pushover message, warning light, siren, etc.).

---
### Additional Requirements
The following packages are needed for the plugin to function properly:
- `strip-ansi`
- `child_process`

---
### Configuration
The plugin allows for the configuration of stateful or timed switches, with a number of option, including switches that are triggered by keywords appearing in the Homebridge log file.

- 
- **Platform Name:** Must be `HomebridgeVirtualSwitches` (cannot be changed).

Devices:
- **Switch Name:** Define a unique name for each switch.
- **Stateful:** Determines the switch behavior after being triggered:
    - **Stateful:** The switch state does not change after being triggered.
    - **Non-stateful:** The switch state returns to its normal state after a timer runs out (default).
     
- **Normally Closed Switch:** Set the switch type: normally open (default) or normally closed.
    
    - Normally Open: in its untriggered state, the switch is OFF. This is the default setting.
    - Normally Closed: in its untriggered state, the switch is ON
     
- **Timer:** Select for timed switches. After being triggered, the switch will return to its initial state after a timer has expired. 
     
    The default timer time is set in milliseconds. 

    - Optionally the **Timer** time can be set in days/hours/minutes/seconds.
        
      <u>Note:</u> 
        
      - Total time in either time format cannot exceed ~47 days.
      - If both time formats are set correctly, the days/hours/minutes/seconds time will be used provided that box was also checked. If not the time in milliseconds will be used.
      - If no time is set in either format and the switch is not Stateful, the switch will not be initialized and an error will show in the log file



    - **Persistent Timer:** when selected, the switch (MUST be controlled by a timer) can be made to persist through Homebridge shutdowns and restarts. When the switch is triggered, the end time is calculated. If Homebridge shutsdown and then restarts, the plugin checks if that end time has been reached: 

        - If the end time was reached while Homebridge was shut down, the switch reverts to its untriggered state upon restart.
        - If the end time has not yet been reached while Homebridge was shut down, the switch continue in its triggered state until the end time is reached.
    
    
- **Trigger switch by keywords appearing in the Homebridge Log File:** Select to trigger the switch by keywords that appear in the log file. The default file monitored is the Homebridge log file.
    
   The plugin monitors the log file as the lines are registered in the file.

    - **Log File Path:** Enter the full path to the log file to monitor and the filename

        <u>Note:</u> 
        - The default file to monitor is the Homebridge log file location.
        - Different switches can monitor different files
        - The file must be in UDF8 format.
        
    - **Keywords:** Enter one keyword or key phrase as it appears in the log file. 
       
       <u>Note:</u> the plugin:
        - ignore upper case letters in the keyword and the log file 
        - removes ANSI escape characters from the keyword
        - ignore keywords that appear in this plugin's DEBUG lines 
        
    - **Delay switch start:** Delay switch activation after Homebridge starts. Select this to prevent premature triggering of the switch by trigger ords that appear during e.g. the start of Homebridge.
       
       <u>Note:</u> Delay switch start is for <u>log monitoring switches only</u>.
    
      The default timer time is set in milliseconds. 

      Optionally the **Timer** time can be set in days/hours/minutes/seconds.
        
      <u>Note:</u> 
        
       - Total time in either time format cannot exceed ~47 days.
       - If both time formats are set, the switch will not be initialized and show an error in the Homebridge log.
    
- **Restart in Last Known State:** If enabled, the switch will start in its last known state before Homebridge shut down. 
    
  <u>Note:</u> This only works for stateful switches not controlled by log file keywords.

Plugin config:
   
- **Name:** Do not change this field.


Multiple switches can be set up, each with its own configuration.



---
### Operation of Switches Controlled by Log File Keywords
Switches can be stateful or not. If set, the occurrence of one or more keywords/phrases triggers the corresponding switch.

- **Stateful Switches:** Once triggered, reoccurrence of the keyword/phrase will not change the switch state until it is manually reset.
- **Non-stateful Switches:** The switch will not be retriggered until the timer has expired.

*Note:* Repeated triggering of a non-stateful switch will not extend nor reset the timer.

---
### Found a Bug?
If you think you've found a bug, please first check the requirements and read through the open issues. If you're confident it's a new bug, create a new GitHub issue with as much information as possible. Please be patient as we review your report.
