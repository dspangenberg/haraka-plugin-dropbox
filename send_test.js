'use strict'

const net = require('net')
const fs = require('fs')
const HOST = 'localhost'
const PORT = 2526
const USERNAME = 'test'
const PASSWORD = 'test'

const eml = fs.readFileSync('test_forward.eml', 'utf8')

const socket = new net.Socket()
let step = 0

const commands = [
  () => socket.write('EHLO localhost\r\n'),
  () => socket.write('AUTH LOGIN\r\n'),
  () => socket.write(Buffer.from(USERNAME).toString('base64') + '\r\n'),
  () => socket.write(Buffer.from(PASSWORD).toString('base64') + '\r\n'),
  () => socket.write(`MAIL FROM:<test2@example.com>\r\n`),
  () => socket.write(`RCPT TO:<test@dropbox.opsc.cloud>\r\n`),
  () => socket.write('DATA\r\n'),
]

socket.connect(PORT, HOST, () => {
  console.log('Connected to SMTP server')
})

socket.on('data', (data) => {
  const response = data.toString()
  console.log('SMTP:', response.trim())

  if (response.startsWith('220')) {
    step = 0
    commands[step++]()
  } else if (response.startsWith('250') || response.startsWith('235')) {
    if (step < commands.length) {
      commands[step++]()
    }
  } else if (response.startsWith('334')) {
    commands[step++]()
  } else if (response.startsWith('354')) {
    socket.write(eml + '\r\n.\r\n')
    socket.write('QUIT\r\n')
  }
})

socket.on('close', () => {
  console.log('Connection closed')
})

socket.on('error', (err) => {
  console.error('Error:', err.message)
})
