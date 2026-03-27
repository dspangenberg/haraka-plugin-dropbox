'use strict'

exports.register = function () {
  this.load_dropbox_ini()

  // register hooks here. More info at https://haraka.github.io/core/Plugins/
  // this.register_hook('data_post', 'do_stuff_with_message')
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
