'use strict'
const axios = require('axios')
const simpleParser = require('mailparser').simpleParser
const stringify = require('string.ify')
const DSN = require('haraka-dsn')

exports.register = function () {
  this.load_dropbox_ini()

  // register hooks here. More info at https://haraka.github.io/core/Plugins/
  this.register_hook('rcpt', 'check_rcpt')
  this.register_hook('data', 'parse_body')
  this.register_hook('data_post', 'post_to_dropbox')
}

exports.check_rcpt = function (next, connection, params) {
  const rcpt_to = `${params[0].user}@${params[0].host}`
  const url = this.cfg.dropboxes[rcpt_to]
  if (url) {
    next(OK)
  } else {
    next(DENY, DSN.no_such_user())
  }
}

exports.parse_body = function (next, connection) {
  connection.transaction.parse_body = true
  return next()
}

exports.post_to_dropbox = function (next, connection) {
  const plugin = this
  plugin.loginfo('hook_data_post called')

  if (!connection.transaction.message_stream) {
    plugin.logerror('No message_stream available')
    return next()
  }

  plugin.loginfo(
    'message_stream type: ' + typeof connection.transaction.message_stream,
  )
  plugin.loginfo(
    'message_stream readable: ' +
      connection.transaction.message_stream.readable,
  )

  simpleParser(connection.transaction.message_stream, (err, mail) => {
    if (err) {
      plugin.logerror('simpleParser error: ' + err)
      return next()
    }

    plugin.loginfo('simpleParser completed')
    plugin.loginfo('E-Mail: ' + stringify(mail))

    const messageId = mail.messageId || Date.now() + '@haraka'

    let rcpt_to

    if (
      !!connection.transaction.rcpt_to &&
      connection.transaction.rcpt_to.length > 0
    ) {
      const rcpt = connection.transaction.rcpt_to[0]
      rcpt_to = `${rcpt.user}@${rcpt.host}`
    }

    plugin.loginfo('rcpt_to', rcpt_to)

    const url = plugin.cfg.dropboxes[rcpt_to]
    plugin.loginfo('Dropbox ', url)
    if (url) {
      const _email = {
        from: mail.from.value.map((item) => item.address),
        to: mail.to.value.map((item) => item.address),
        rcpt_to: rcpt_to,
        cc: mail.cc,
        bcc: mail.bcc,
        subject: mail.subject,
        message_id: messageId,
        attachments: mail.attachments || [],
        html: mail.html,
        text: mail.text,
        textAsHtml: mail.textAsHtml,
        timestamp: new Date(),
        references: mail.references || [],
      }

      if (!!mail.inReplyTo && mail.inReplyTo.length > 0)
        _email.in_reply_to = mail.inReplyTo[0]
      else _email.in_reply_to = false

      plugin.loginfo('Processed E-Mail: ' + stringify(_email))

      axios.post(url, {
        payload: _email,
      })

      next(OK)
    } else {
      next(DENY, DSN.no_such_user())
    }
  })
}

exports.load_dropbox_ini = function () {
  this.cfg = this.config.get(
    'dropbox.ini',
    {
      booleans: [
        '+enabled', // this.cfg.main.enabled=true
        '-disabled', // this.cfg.main.disabled=false
        '+feature_section.yes', // this.cfg.feature_section.yes=true
      ],
    },
    () => {
      // This closure is run a few seconds after dropbox.ini changes
      // Re-run the outer function again
      this.load_dropbox_ini()
    },
  )
}
