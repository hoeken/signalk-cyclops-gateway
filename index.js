const dgram = require('dgram');

module.exports = function(app) {
  let plugin = {};
  let unsubscribes = [];

  plugin.id = 'signalk-cyclops-gateway';
  plugin.name = 'Cyclops Gateway';
  plugin.description = 'Pull data from a Cyclops Marine Gateway into SignalK';
  
  plugin.schema = {
    type: 'object',
    required: ['method'],
    properties: {
      gateway_ip: {
        type: 'string',
        title: 'Cyclops Gateway IP Address',
        default: ''
      },
      interval: {
        type: 'number',
        title: 'Polling Interval (milliseconds)',
        default: 10000
      },
      udp_port: {
        type: 'number',
        title: 'Cyclops Gateway UDP Port (0 to disable)',
        default: 50000
      },
    }
  };
  
  plugin.units = [];

  plugin.start = function(options, restartPlugin) {
    if (typeof options.interval === 'undefined' || !options.interval)
      options.interval = 10000;

    if (typeof options.gateway_ip === 'undefined') {
      app.setPluginError("No gateway IP defined.");
      return;
    }

    plugin.options = options;

    app.setPluginStatus(`Startup`);

    // Initial lookup to get detailed system information
    plugin.pollGatewayData();
    
    // POLLING thread
    const intervalId = setInterval(plugin.pollGatewayData, options.interval);
    unsubscribes.push(() => clearInterval(intervalId));      

    // UDP Server for fast updates
    if (options.udp_port) {
      plugin.startListeningUDP();
      unsubscribes.push(() => plugin.stopListeningUDP());
    }
  };

  plugin.stop = function() {
    unsubscribes.forEach(f => f());
    unsubscribes = [];
  };
  
  plugin.startListeningUDP = function(ip, port = 5000) {
    
    plugin.server = dgram.createSocket({ type: 'udp4', reuseAddr: true });  

    plugin.server.on('error', (err) => {
      console.error(`Server error:\n${err.stack}`);
      plugin.server.close();
    });

    plugin.server.on('message', (msg, rinfo) => {
      //console.log(`Received ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`);

      // Convert the buffer to a UTF-8 string
      let data = msg.toString('utf8').trim();
      //console.log(`Raw data: ${data}`);

      // Attempt to find the NMEA sentence starting with '$'
      const dollarIndex = data.indexOf('$');
      if (dollarIndex === -1) {
        console.warn('No NMEA sentence found in the payload.');
        return;
      }
      // Extract the sentence (up to the end of line or end of string)
      const sentence = data.slice(dollarIndex).split(/\r?\n/)[0];
      //console.log(`Extracted NMEA Sentence: ${sentence}`);

      // Validate that a checksum is present (indicated by '*')
      const starIndex = sentence.indexOf('*');
      if (starIndex === -1 || starIndex + 3 > sentence.length) {
        console.warn('Invalid NMEA sentence: Checksum not found.');
        return;
      }

      // Extract the provided checksum (2 hex digits after '*')
      const providedChecksumStr = sentence.substring(starIndex + 1, starIndex + 3);
      const providedChecksum = parseInt(providedChecksumStr, 16);
      const computedChecksum = calculateChecksum(sentence);

      if (computedChecksum !== providedChecksum) {
        console.warn(`Checksum mismatch. Computed: ${computedChecksum.toString(16)}, Provided: ${providedChecksumStr}`);
        return;
      }

      // console.log(`Checksum valid: ${providedChecksumStr}`);

      // Split the sentence into fields (ignoring the leading '$' and checksum part)
      const content = sentence.substring(1, starIndex); // remove '$' and remove checksum part
      const fields = content.split(',');

      // For example, for the sentence "$CRXDR,C,0.65,C,PORT*5b"
      // fields[0] = "CRXDR" (talker + sentence type)
      // fields[1] = "C"      (transducer type)
      // fields[2] = "0.65"   (measurement value)
      // fields[3] = "C"      (units)
      // fields[4] = "PORT"   (sensor identifier)
      // console.log('Parsed NMEA fields:');
      // fields.forEach((field, index) => {
      //   console.log(`  Field ${index}: ${field}`);
      // });

      // Remove non-alphanumeric characters (except spaces) then replace spaces with underscores.
      let cleanedTitle = fields[4].replace(/[^a-zA-Z0-9 ]/g, '').replace(/ /g, '_').toLowerCase();
      let path = `rigging.${cleanedTitle}.tension`;

      //convert to SI units
      let value = parseFloat(fields[2]);
      value = plugin.convertUnits(value, plugin.units[cleanedTitle]);

      //console.log(`${cleanedTitle}: ${value}`);

      // Create a SignalK delta update message
      const delta = {
        context: "vessels.self",
        updates: [
          {
            source: { label: plugin.name },
            timestamp: new Date().toISOString(),
            values: []
          }
        ]
      };
      
      // Post the delta update to SignalK
      delta.updates[0].values.push({
        path: path,
        value: value
      });
      app.handleMessage("delta", delta);
    });

    plugin.server.on('listening', () => {
      const address = plugin.server.address();
      app.setPluginStatus(`Listening on ${address.address}:${address.port}`)
      console.log(`signalk-cyclops-gateway listening on ${address.address}:${address.port}`);
    });

    // Bind the server to our port and enable broadcast reception
    plugin.server.bind(plugin.options.udp_port, () => {
      plugin.server.setBroadcast(true);
    });    
  }
  
  plugin.stopListeningUDP = function() {
    plugin.server.close(() => {
      console.log('Server closed.');
    });
  };  
  
  plugin.pollGatewayData = function() {
    fetch(`http://${plugin.options.gateway_ip}/latest/`)
      .then(response => {
        // Check if the response is OK (status in the range 200-299)
        if (!response.ok) {
          app.setPluginError(`Network response was not ok: ${response.status} ${response.statusText}`);
        }
        // Parse the JSON
        return response.json();
      })
      .then(data => {
        // Create a SignalK delta update message
        const delta = {
          context: "vessels.self",
          updates: [
            {
              source: { label: plugin.name },
              timestamp: new Date().toISOString(),
              values: []
            }
          ]
        };
        
        let metas = [];
        
        // Loop over each sensor in the JSON array
        data.forEach(sensor => {
          // Remove non-alphanumeric characters (except spaces) then replace spaces with underscores.
          let cleanedTitle = sensor.title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/ /g, '_').toLowerCase();
          let path = `sensors.cyclops.${cleanedTitle}`;
          
          //save our units for conversion
          plugin.units[cleanedTitle] = sensor.units;
          //console.log(`${cleanedTitle}: ` + plugin.units[cleanedTitle]);          

          //convert it.
          let value = parseFloat(sensor.value);
          value = plugin.convertUnits(value, plugin.units[cleanedTitle]);
          
          delta.updates[0].values.push({
            path: `${path}.id`,
            value: sensor.id
          });

          delta.updates[0].values.push({
            path: `${path}.title`,
            value: sensor.title
          });

          delta.updates[0].values.push({
            path: `${path}.station`,
            value: sensor.station
          });

          delta.updates[0].values.push({
            path: `${path}.rssi`,
            value: parseInt(sensor.rssi)
          });

          delta.updates[0].values.push({
            path: `${path}.time`,
            value: parseFloat(sensor.time)
          });

          delta.updates[0].values.push({
            path: `${path}.age`,
            value: parseFloat(sensor.age)
          });

          delta.updates[0].values.push({
            path: `rigging.${cleanedTitle}.tension`,
            value: value,
          });
          
          metas.push({
            path: `rigging.${cleanedTitle}.tension`,
            value: {
              units: 'N',
              description: 'Newtons'
            }
          });
        });
                  
        // Post the delta update to SignalK
        app.handleMessage("delta", delta);
        
        // Our meta updates
        app.handleMessage(plugin.id, {
          updates: [{ meta: metas }]
        });
      })
      .catch(error => {
        // Handle any errors that occurred during the fetch or parsing
        app.setPluginError('Fetch error:', error);
      });
  };
  
  plugin.convertUnits = function (value, units) {
    const gravitationalAcceleration = 9.80665; // m/s², average gravitational acceleration on Earth

    if (units == 'kg')
      return value * gravitationalAcceleration;
    else if (units == 'tonne')
      return value * 1000 * gravitationalAcceleration;
    else if (units == 'lbf')
      return value * 4.44822; // 1 lbf is approximately 4.44822 newtons
    else
      return value;
  };
  
  // Function to calculate NMEA0183 checksum
  function calculateChecksum(nmeaSentence) {
    // Remove the starting '$' if present and split at '*'
    const sentence = nmeaSentence.startsWith('$')
      ? nmeaSentence.slice(1, nmeaSentence.indexOf('*'))
      : nmeaSentence.slice(0, nmeaSentence.indexOf('*'));

    let checksum = 0;
    for (let i = 0; i < sentence.length; i++) {
      checksum ^= sentence.charCodeAt(i);
    }
    return checksum;
  }

  return plugin;
};