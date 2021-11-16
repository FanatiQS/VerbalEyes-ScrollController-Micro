const { Server: TcpServer, Socket: TcpClient} = require("net");
const fs = require("fs");
const dns = require("dns");
const os = require("os");

const { WebSocketServer } = require("ws");



/* CLI arguments:
 * 		path to serial port
 * 		if definced will not write configuration (used to not wear out flash memory during development)
 */



// Defines configuration parameters based on covering all 8 bit ints
const CONF_VALUE_SSID = Buffer.from("defghijklmnopqrstuvwxyzABCDEFGHI");
const CONF_VALUE_SSIDKEY = Buffer.concat([
	Buffer.from("!#%&'()*,-/:;<=>@^_`{|}~ JKLMNOPQRSTUVWXYZ0123456789???????"),
	Buffer.from([ 0xc3, 0xa5, 0xc2, 0xb5 ])
]);
const CONF_VALUE_HOSTNAME = Buffer.concat([
	Buffer.from([
		0xc4, 0x80, 0xc5, 0x81, 0xc6, 0x82, 0xc7, 0x83, 0xc8, 0x84, 0xc9, 0x85, 0xca, 0x86, 0xcb, 0x87,
		0xcc, 0x88, 0xcd, 0x89, 0xce, 0x8a, 0xcf, 0x8b, 0xd0, 0x8c, 0xd1, 0x8d, 0xd2, 0x8e, 0xd3, 0x8f,
		0xd4, 0x90, 0xd5, 0x91, 0xd6, 0x92, 0xd7, 0x93, 0xd8, 0x94, 0xd9, 0x95, 0xda, 0x96, 0xdb, 0x97,
		0xdc, 0x98, 0xdd, 0x99, 0xde, 0x9a, 0xe1, 0x9b, 0x9c, 0xe2, 0x9d, 0x9e
	]),
	Buffer.from(".abc")
]);
const CONF_VALUE_PATH = Buffer.from([
	0xe0, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xee, 0xef, 0xf0, 0xf1,
	0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff, 0xdf, 0x9f
]);
const CONF_VALUE_PROJ = Buffer.from([
	0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xab, 0xac, 0xad, 0xae, 0xaf, 0xb0,
	0xb1, 0xb2, 0xb3, 0xb4, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xbb, 0xbc, 0xbd, 0xbe, 0xbf, 0xc0, 0xc1
]);
const CONF_VALUE_PROJKEY = Buffer.concat([
	Buffer.from([
		0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x09, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15,
		0x16, 0x17, 0x18, 0x19, 0x1a, 0x1c, 0x1d, 0x1e, 0x1f
	]),
	Buffer.from('"$+?[\\]')
]);
const CONF_VALUE_PORT_A = ("\r".charCodeAt(0) << 8 ) | "\n".charCodeAt(0);
const CONF_VALUE_PORT_B = (0x00 << 8) | 0x7f;




// Defines redirect port for WebSocket server
const WS_PORT = 8080;

// Defines where path starts in HTTP request
const PATH_OFFSET = 4;

// Defines configuration lengths
const CONF_LEN_SSID = 32;
const CONF_LEN_SSIDKEY = 63;
const CONF_LEN_HOST = 64;
const CONF_LEN_PATH = 32;
const CONF_LEN_PROJ = 32;
const CONF_LEN_PROJKEY = 32;



// Boolean indicating if any WebSocket frame has contained a null byte as a result of its payload being masked.
// Device should not stop when null byte is reached and that is what is tested.
let gotNullByte = false;

// Boolean indicating that authentication has completed and that scroll data can now be received
let authComplete = false;

// The read stream connected to the serial device
let confReadStream = null;



// Tests that configuration value is the correct length
function testConfLen(name, conf, len) {
	if (conf.length === len) return;
	console.error(`Configuration for ${name} was not correct length`, conf.length, len);
}

// Tests what characters are included in the configuration test
function testChars() {
	// Ensures configurations are configured to the max length
	testConfLen("ssid", CONF_VALUE_SSID, CONF_LEN_SSID);
	testConfLen("ssidkey", CONF_VALUE_SSIDKEY, CONF_LEN_SSIDKEY);
	testConfLen("host", CONF_VALUE_HOSTNAME, CONF_LEN_HOST);
	testConfLen("path", CONF_VALUE_PATH, CONF_LEN_PATH);
	testConfLen("proj", CONF_VALUE_PROJ, CONF_LEN_PROJ);
	testConfLen("projkey", CONF_VALUE_PROJKEY, CONF_LEN_PROJKEY);

	// Checks what charactes are included and missing
	let chars = [...Buffer.concat([
		Buffer.from("\f\v\b\x1b"),
		CONF_VALUE_SSID,
		CONF_VALUE_SSIDKEY,
		CONF_VALUE_HOSTNAME,
		CONF_VALUE_PATH,
		CONF_VALUE_PROJ,
		CONF_VALUE_PROJKEY,
		Buffer.from([ (CONF_VALUE_PORT_A >> 8), CONF_VALUE_PORT_A & 0xff ]),
		Buffer.from([ (CONF_VALUE_PORT_B >> 8), CONF_VALUE_PORT_B & 0xff ]),
	])];
	let last = 0;
	let lastMatch = true;
	for (let i = 0; i <= 256; i++) {
		const match = chars.includes(i);
		if (match === lastMatch) continue;
		console.log(`0x${last.toString(16)} => 0x${(i - 1).toString(16)} was ${(match) ? "not " : ""}included in configurations`);
		lastMatch = match;
		last = i;
	}
}
testChars();



// Prints the characters to debug mismatch
function printConfMismatch(confName, a, b, len) {
	// Ensures a and b match
	if (!Buffer.compare(a, b)) {
		console.log(`Configuration for ${confName} is correct`);
		return;
	}

	// Prints the characters for debug
	console.error(`Configuration for ${confName} is incorrect`);
	for (let i = 0; i < len; i++) {
		console.error(`index: ${i}\tconf: ${b[i]}\t data: ${a[i]}`);
	}
	process.exit(1);
}



// Creates TCP server
const tcpServer = new TcpServer(async function (sock) {
	const data = await new Promise((resolve) => sock.once('data', resolve));

	// Ensures path is correct
	const path = data.slice(PATH_OFFSET, PATH_OFFSET + CONF_LEN_PATH);
	printConfMismatch("path", path, CONF_VALUE_PATH, CONF_LEN_PATH);

	// Creates socket connection to WebSocket server and sends HTTP data with path replaced
	const redirectSocket = new TcpClient();
	await new Promise((resolve) => redirectSocket.connect(WS_PORT, () => resolve()));
	redirectSocket.write("GET / " + data.toString().slice(PATH_OFFSET + CONF_LEN_PATH));

	// Redirects data to other socket
	redirectSocket.on('data', (data) => sock.write(data));
	sock.on('data', (data) => {
		// Ensures implementation on device can handle null byte in maksed WebSocket payload
		if (!gotNullByte && data.slice(0, data.length - 1).includes(0)) {
			console.log("Can handle null bytes in WebSocket data");
			gotNullByte = true;
		}

		// Writes WebSocket text data as binary to WebSocket server
		if (data[0] === 0x81) data[0] = 0x82;
		redirectSocket.write(data);
	});

	// Binds sockets close events
	redirectSocket.on('close', () => sock.destroy());
	sock.on('close', () => redirectSocket.destroy());
});



// Creates WebSocket server
const wss = new WebSocketServer({ port: WS_PORT, clientTracking: true });
wss.on('connection', (ws) => {
	// Sends all characters from 1 to 255 to ensure they can be printed correctly on the device
	const chars = [];
	for (let i = 1; i < 256; i++) chars.push(i);
	ws._socket.write(Buffer.concat([
		Buffer.from("---start---"),
		Buffer.from(chars, 'binary'),
		Buffer.from("---end---")
	]));

	// Handles WebSocket text/binary events
	ws.on('message', async (data) => {
		data = data.toString('binary'); // WebSocket text events are converted to binary events to allow for binary stringification

		// Handles authentication request
		if (data.includes('"auth": ')) {
			// Ensures proj is correct
			const proj = data.match(/"id": "(.*?)"/)[1];
			printConfMismatch("proj", Buffer.from(proj, 'binary'), CONF_VALUE_PROJ, CONF_LEN_PROJ);

			// Ensures projkey is correct
			const projkey = data.match(/"auth": "(.*)"/)[1];
			printConfMismatch("projkey", Buffer.from(projkey, 'binary'), CONF_VALUE_PROJKEY, CONF_LEN_PROJKEY);

			// Awaits sending response to ensure no scroll data is transmitted before authenticated
			await new Promise((resolve) => setTimeout(resolve, 4000));
			authComplete = true;

			// Sends authentication response
			ws.send(`[{"id": !!, "auth": true}]`);//!!
		}
		// Handles scroll update
		else {
			// Ensures no scroll data is sent before authentication is completed
			if (!authComplete) {
				console.error("Got data before authentication was completed");
				process.exit();
			}

			//!! test setspeed can be sent

			// Continues until everything is tested
			if (gotNullByte) close();
		}
	});

	// Logs WebSocket close and error events
	ws.on('close', () => console.log("WebSocket closed"));
	ws.on('error', (err) => console.error("WebSocket error", err));
});



// Creates DNS server
//!! create dns server code



// Closes everything and tests logs from serial
async function close() {
	// Closes servers and clients
	tcpServer.close();
	wss.close();
	for (const sock of wss.clients) sock.terminate();

	// Makes sure all logs have been transmitted
	await new Promise((resolve) => setTimeout(resolve, 1000));

	// Gets logs from device
	const data = confReadStream.read().toString('binary');
	confReadStream.close();

	// Gets printed chunk of all printable characters from http headers
	const allChars = data.slice(data.indexOf("---start---") + 11, data.indexOf("---end---")).toString();
	const buf = [];
	for (let i = 1; i < 256; i++) buf.push(i);
	const src = String.fromCharCode(...buf).replace("\n", "\n\t");

	// Ensures that http body containing every byte was printed correctly
	if (src === allChars) {
		console.log("All characters were printed correctly");
	}
	// Prints error if data did not match
	else {
		console.error("Not all characters were printed correctly");
		console.error(src.length, allChars.length);
		for (let i = 1; i < 256; i++) {
			console.error(`index: ${i}\tdata: ${allChars.charCodeAt(i - 1)}\tbuf: ${src.charCodeAt(i - 1)}`);
		}
	}

	//!! ignores hostname tests for now
	return;

	// Tests hostname
	fs.writeFileSync(serialPath, Buffer.concat([
		Buffer.from("\nhost="),
		CONF_VALUE_HOSTNAME,
		Buffer.from("\nport="),
		Buffer.from(CONF_VALUE_PORT_A.toString()),
		Buffer.from("\n\n")
	]));
};



// Gets command line arguments
const serialPath = process.argv[2];
const testNetworkAndHostName = false;



// Start testing
console.log("This is going to clear all configuration data on the device.");
console.log("Do you want to start the test? (yes/no)");
process.stdin.once('data', async (data) => {
	// Stops listening to stdin
	process.stdin.pause();

	// Aborts test
	if (data.toString() !== "yes\n") {
		wss.close();
		confReadStream.close();
		return;
	}

	// Connects to the serial device
	console.log(`Connecting to device at: ${serialPath}`);
	confReadStream = fs.createReadStream(serialPath);
	confReadStream.once('error', (err) => {
		console.error("Unable to connect to device.");
		process.exit();
	});

	// Ensures no other functions are called during idle configuration
	confReadStream.read();
	fs.writeFileSync(serialPath, "---test---");
	while (1) {
		const data = await new Promise((resolve) => confReadStream.once('data', resolve));
		if (data.includes("---test---")) break;
	}
	console.log("Rotate potentiomer and press reset button while data is gathered from the device...");
	await new Promise((resolve) => setTimeout(resolve, 6000));
	const readData = confReadStream.read();
	if (readData !== null) {
		console.error(readData.toString());
		console.error(readData);
		console.error("Implementation logged this data when it was expected to be idle");
		process.exit();
	}
	fs.writeFileSync(serialPath, "\n\n");

	// Creates wifi connection
	//!! console.log("Creates wifi connection");
	//!! create wifi connection code

	// Writes configuration to device
	if (!process.argv[3]) { //!! remove this check later and the description at the top for the cli argument
		const addr = await new Promise((r) => dns.lookup(os.hostname(), (e, addr) => r(addr))); //!! might not need to look up addr if setting static ip for custom wifi
		fs.writeFileSync(serialPath, Buffer.concat([
			//!! Buffer.from("ssid="),
			//!! CONF_VALUE_SSID,
			//!! Buffer.from("ssidkey="),
			//!! CONF_VALUE_SSIDKEY,
			Buffer.from("\nhost="),
			Buffer.from(addr),
			Buffer.from("\nport="),
			Buffer.from(CONF_VALUE_PORT_A.toString()),
			Buffer.from("\npath="),
			CONF_VALUE_PATH,
			Buffer.from("\nproj="),
			CONF_VALUE_PROJ,
			Buffer.from("\nprojkey="),
			CONF_VALUE_PROJKEY,
			Buffer.from("\n\n")
		]));
	}

	// Restarts device
	console.log("Restart the device by unplugging its power.");
	confReadStream.resume();
	await new Promise((resolve) => confReadStream.once('close', resolve));
	console.log("The device has been disconnected and power can be restored.");
	let done = false;
	while (!done) {
		confReadStream = fs.createReadStream(serialPath);
		await new Promise((resolve) => {
			confReadStream.once('open', () => {
				done = true;
				resolve();
			});
			confReadStream.once('error', (err) => {
				setTimeout(resolve, 500);
			});
		});
	}
	console.log("The device has reconnected.");

	// Tests can start
	console.log("Test started, you might need to adjust the speed to complete all tests");
	confReadStream.read();
	tcpServer.listen(CONF_VALUE_PORT_A);
});








/* other tests to include:

 * Tests wifi connection failing to connect?
 * Tests socket connection failing to connect?

 * Tests that setscroll and resetoffset are not called during initialize
 	This has been implemented but not tested

 * Tests that setscroll can be called after initialize
 * Tests setscroll range? Might not be needed
 * Optional test for resetoffset

 * Tests that a client can connect to a server with hostname
 * Create wifi network

 * Should hostname test be optional since dns lookup is technically not required?

 */

 /* test blinky light, would need to be done manually, but the states could exist maybe?
  *		configuration
  *		connecting
  *		sending data
  *		idle
  */
