# signalk-cyclops-gateway

SignalK server plugin to pull data from a [Cyclops Marine Gateway](https://www.cyclopsmarine.com/products/gateway/) and push it into SignalK

# Configuration

* Setup your Cyclops Marine Gateway to connect to your boat's wifi network.
* Enter the IP address of your Cyclops Marine Gateway into the plugin configuration.
* Decide if you want to use Polling or UDP streaming:
  * Polling will give you access to the low level details like id, name, station, units, rssi, time, age of data, and of course the load values.
  * I haven't tested if there are any performance downsides to using polling with a low interval, but its not as efficient as UDP.
  * UDP streaming will only give you access to the name and load value, but you get the data into SignalK as quickly as possible and as often as the gateway can send it.
* If you're using UDP streaming, you need to go into your Cyclops Marine Gateway web UI and enable "UDP Broadcast" -> "NMEA0183" for *every* sensor.
  * Set "Address" to 255.255.255.255
  * Set "Port" to 50000 (or whatever you choose in your own config if needed)
  * Set "Talker" to AG - Autopilot - General
  * Set "Sentence" to XDR - Transducer: TempAir, C  (this sentence allows the gateway to send the name of the unit with the value)
