module.exports = function(app) {
  let plugin = {};
  let unsubscribes = [];

  plugin.id = 'signalk-cyclops-gateway';
  plugin.name = 'Cyclops Gateway';
  plugin.description = 'Pull data from a Cyclops Marine Gateway into SignalK';

  plugin.schema = {
    type: 'object',
    required: ['interval'],
    properties: {
      interval: {
        type: 'number',
        title: 'Update Interval (milliseconds)',
        default: 1000
      },
      gateway_ip: {
        type: 'string',
        title: 'Gateway IP Address',
        default: ''
      },
    }
  };

  plugin.start = function(options, restartPlugin) {
    if (typeof options.interval === 'undefined' || !options.interval)
      options.interval = 1000;
    const updateInterval = options.interval;

    if (typeof options.gateway_ip === 'undefined') {
      app.setPluginError("No gateway IP defined.");
      return;
    }
    
    const gatewayIP = options.gateway_ip;

    const loadGatewayData = () => {
      fetch(`http://${gatewayIP}/latest/`)
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
          
          // Loop over each sensor in the JSON array
          data.forEach(sensor => {
            // Remove non-alphanumeric characters (except spaces) then replace spaces with underscores.
            let cleanedTitle = sensor.title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/ /g, '_').toLowerCase();
            let path = `sensors.cyclops.${cleanedTitle}`;
            
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
              path: `${path}.units`,
              value: sensor.units
            });

            delta.updates[0].values.push({
              path: `${path}.value`,
              value: parseFloat(sensor.value)
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
          });
          
          // Post the delta update to SignalK
          app.handleMessage("delta", delta);
        })
        .catch(error => {
          // Handle any errors that occurred during the fetch or parsing
          app.setPluginError('Fetch error:', error);
        });
    };

    // Set interval for periodic updates
    const intervalId = setInterval(loadGatewayData, updateInterval);
    unsubscribes.push(() => clearInterval(intervalId));
  };

  plugin.stop = function() {
    unsubscribes.forEach(f => f());
    unsubscribes = [];
  };

  function setSystemTimezone(timezone, useSudo = true) {
    //this is for our internal node.js timezone.
    process.env.TZ = timezone;
  
    const setTimezone = `timedatectl set-timezone ${timezone}`
    const command = useSudo
      ? `if sudo -n timedatectl &> /dev/null ; then sudo ${setTimezone} ; else exit 3 ; fi`
      : setTimezone

      exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error setting timezone: ${error.message}`);
        return;
      }
      if (stderr) {
        console.error(`stderr: ${stderr}`);
        return;
      }
      console.log(`Timezone set to: ${timezone}`);
    });
  }

  return plugin;
};
