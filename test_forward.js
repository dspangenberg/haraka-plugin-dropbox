'use strict'

const { writeFileSync } = require('node:fs')

const RAW_EMAIL = [
  'From: test@example.com',
  'To: test2@example.com',
  'Subject: Fwd: Test Email',
  'Message-ID: <test123@example.com>',
  'Date: Mon, 01 Jan 2024 12:00:00 +0000',
  '',
  '',
  '---------- Forwarded message ---------',
  'From: Original Sender <original@example.com>',
  'To: test2@example.com',
  'Date: Mon, 01 Jan 2024 11:00:00 +0000',
  'Subject: Original Subject',
  '',
  'This is the original email body.',
  'It can contain multiple lines.',
  '',
].join('\r\n')

writeFileSync('test_forward.eml', RAW_EMAIL)
console.log('Written: test_forward.eml')
console.log(RAW_EMAIL)
