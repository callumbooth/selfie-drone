const dgram = require('dgram')
const express = require('express')
const http = require('http')
const socket = require('socket.io')
// WebSocket for broadcasting stream to connected clients
const WebSocket = require('ws')
const app = express()
const httpServer = http.Server(app)
const io = socket(httpServer)

const throttle = require('lodash/throttle')

// We'll spawn ffmpeg as a separate process
const spawn = require('child_process').spawn

const PORT = 8889
const HOST = '192.168.10.1'
const drone = dgram.createSocket('udp4')
drone.bind(PORT)

function parseState(state) {
  return state
    .split(';')
    .map((x) => x.split(':'))
    .reduce((data, [key, value]) => {
      data[key] = value
      return data
    }, {})
}

const droneState = dgram.createSocket('udp4')
droneState.bind(8890)

drone.on('message', (message) => {
  console.log('drone:', message.toString())
  io.sockets.emit('status', message.toString())
})

drone.on('error', (err) => {
  console.log(`drone error: ${err}`)
})

// droneState.on(
//   'message',
//   throttle((state) => {
//     const formattedState = parseState(state.toString())
//     io.sockets.emit('dronestate', formattedState)
//   }, 16)
// )

function handleError(err) {
  if (err) {
    console.log('ERROR')
    console.log(err)
  }
}

//This puts the drone into SDK mode
drone.send('command', 0, 'command'.length, PORT, HOST, handleError)

io.on('connection', (socket) => {
  socket.on('command', (command) => {
    console.log(command + ' command sent from browser')

    drone.send(command, 0, command.length, PORT, HOST, handleError)
  })
  socket.emit('status', 'Connected')
})

httpServer.listen(6767, () => {
  console.log('Socket io server running on port 6767')
})

const streamServer = http
  .createServer(function (request, response) {
    // Log that a stream connection has come through
    console.log(
      'Stream Connection on ' +
        6768 +
        ' from: ' +
        request.socket.remoteAddress +
        ':' +
        request.socket.remotePort
    )

    // When data comes from the stream (FFmpeg) we'll pass this to the web socket
    request.on('data', function (data) {
      // Now that we have data let's pass it to the web socket server
      webSocketServer.broadcast(data)
    })
  })
  .listen(6768) // Listen for streams on port 3001

/*
  3. Begin web socket server
*/
const webSocketServer = new WebSocket.Server({
  server: streamServer,
})

// Broadcast the stream via websocket to connected clients
webSocketServer.broadcast = function (data) {
  webSocketServer.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data)
    }
  })
}
// Delay for 3 seconds before we start ffmpeg
setTimeout(function () {
  var args = [
    '-i',
    'udp://0.0.0.0:11111',
    '-r',
    '30',
    '-s',
    '960x720',
    '-codec:v',
    'mpeg1video',
    '-b',
    '800k',
    '-f',
    'mpegts',
    'http://127.0.0.1:6768/stream',
  ]

  // Spawn an ffmpeg instance
  var streamer = spawn('ffmpeg', args)
  // Uncomment if you want to see ffmpeg stream info
  //streamer.stderr.pipe(process.stderr);
  streamer.on('exit', function (code) {
    console.log('Failure', code)
  })
}, 3000)
