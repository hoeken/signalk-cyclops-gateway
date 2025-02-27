# signalk-cyclops-gateway

SignalK server plugin to pull data from a [Cyclops Marine Gateway](https://www.cyclopsmarine.com/products/gateway/) and push it into SignalK

# Configuration

* Setup your Cyclops Marine Gateway to connect to your boat's wifi network.
* Enter the IP address of your Cyclops Marine Gateway into the plugin configuration.
* Setup UDP Streaming:
  * In your Cyclops Marine Gateway web UI and enable "UDP Broadcast" -> "NMEA0183" for *every* sensor.
  * Set "Address" to the subnet of your SignalK server eg. 192.168.1.255
  * Set "Port" to 50000 (or whatever you choose in your own config if needed)
  * Set "Talker" to AG - Autopilot - General
  * Set "Sentence" to XDR - Transducer: TempAir, C  (this sentence allows the gateway to send the name of the unit with the value)
  * Set "Checksum" to checked/enabled

## Some Notes:
* Polling will give you access to the low level details like id, name, station, units, rssi, time, age of data, and of course the load values, but its not a good realtime method
* UDP streaming will only give you access to the name and load value, but you get the data into SignalK as quickly as possible and as often as the gateway can send it.
* The plugin defaults to polling every 10 seconds to pull in sensor details, and uses UDP streaming to get realtime sensor data.

# Paths

* All sensor names will be converted to lowercase, non alphanumeric characters removed, and spaces converted to _
  * eg ```Port V0``` becomes ```port_v0```
* Sensor data output is stored at ```rigging.{sensor}.tension``` and units are in Newtons
  * Newtons to kg: ```value / 9.80665```
  * Newtons to tonnes: ```value / 9.80665 / 1000```
  * Newtons to lbf: ```value / 4.44822```
* Sensor metadata and configuration is stored at ```cyclops.{sensor}.*```
