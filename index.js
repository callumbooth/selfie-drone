const dgram = require("dgram");
const wait = require("waait");
const app = require("express")();
const http = require("http").Server(app);
const io = require("socket.io")(http);
const throttle = require("lodash/throttle");
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const {spawn} = require('child_process');

const commandDelays = require("./commandDelays");

let h264encoder = false;

const PORT = 8889;
const HOST = "192.168.10.1";
const drone = dgram.createSocket("udp4");
drone.bind(PORT);

function parseState(state) {
    return state
        .split(";")
        .map((x) => x.split(":"))
        .reduce((data, [key, value]) => {
            data[key] = value;
            return data;
        }, {});
}

const droneState = dgram.createSocket("udp4");
droneState.bind(8890);

const droneStream = dgram.createSocket("udp4");
droneStream.bind(11111);

drone.on("message", (message) => {
    console.log(`drone : ${message}`);
    io.sockets.emit("status", message.toString());
});

drone.on("error", (err) => {
    console.log(`drone error: ${err}`);
})

droneState.on(
    "message",
    throttle((state) => {
        const formattedState = parseState(state.toString());
        io.sockets.emit("dronestate", formattedState);
    }, 1000)
);

droneStream.on("message", message => {

    if (h264encoder !== false) {
        h264encoder.stdin.write(message.slice(2));
    }
});

droneStream.on("listening", () => {
    var addr = droneStream.address();
    console.log(`Video listening ${addr.address}:${addr.port}`);
});

function handleError(err) {
    if (err) {
        console.log("ERROR");
        console.log(err);
    }
}

function getH264Stream() {
    const command = 'ffmpeg';
    const args = [ '-fflags', 'nobuffer', '-f', 'h264', '-i', "-", '-r', '30', '-c:v', 'libx264', '-b:v', '2M', '-profile', 'baseline', '-preset', 'ultrafast', '-tune', 'zerolatency', '-vsync', '0', '-async', '0', '-bsf:v', 'h264_mp4toannexb', '-x264-params','keyint=5:scenecut=0', '-an', '-f', 'h264', '-'];
    h264encoder = spawn(command, args);
    
    let h264chunks = [];

    h264encoder.stderr.on('data', (data) => {
        //console.log("ffmpeg error", data.toString());
    });
    console.log(h264encoder.stdout);
    h264encoder.stdout.on('data', (data) => {
        console.log(data) 
        let idx = data.indexOf(Buffer([0,0,0,1]));
        if (idx > -1 && h264chunks.length>0) {
            h264chunks.push(data.slice(0,idx));
            try {
                io.sockets.emit("dronestream", Buffer.concat(h264chunks).toString('binary'));
            } catch (e) { console.log(e) }
            h264chunks = [];
            h264chunks.push(data.slice(idx));
        } else {
            h264chunks.push(data);
        }
    });
    
}

//This puts the drone into SDK mode
drone.send("command", 0, "command".length, PORT, HOST, handleError);

io.on("connection", (socket) => {
    socket.on("command", (command) => {
        console.log(command + " command sent from browser");
        
        if (command === "streamon") {
            getH264Stream();
        }
        
        drone.send(command, 0, command.length, PORT, HOST, handleError);
    });
    socket.emit("status", "Connected");
    io.sockets.emit('dronestream', 'streaming');
});

http.listen(6767, () => {
    console.log("Socket io server running on port 6767");
});
