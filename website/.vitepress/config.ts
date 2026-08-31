import { defineConfig } from 'vitepress'

const repository = 'https://github.com/Hannott/Alabaster'

// The site is served from https://hannott.github.io/Alabaster/. Switching to a
// custom domain later means setting `base` to '/' and adding website/public/CNAME.
export default defineConfig({
  base: '/Alabaster/',
  lang: 'en-US',
  title: 'Alabaster',
  description: 'A modern, accessible web interface for Klipper and Moonraker.',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'Interface', link: '/interface/' },
      { text: 'What makes it different', link: '/guide/highlights' },
      { text: 'Reference', link: '/theming' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Introduction', link: '/guide/' },
          { text: 'What makes it different', link: '/guide/highlights' },
          { text: 'Project status', link: '/guide/status' },
          { text: 'Installation', link: '/guide/installation' },
          { text: 'Connecting to Moonraker', link: '/guide/connecting' },
          { text: 'Macros', link: '/guide/macros' },
          { text: 'Several printers', link: '/guide/printers' },
          { text: 'FAQ', link: '/guide/faq' },
        ],
      },
      {
        text: 'Interface',
        link: '/interface/',
        items: [
          { text: 'Dashboard', link: '/interface/overview' },
          { text: 'Farm', link: '/interface/farm' },
          { text: 'Dashboard modules', link: '/interface/modules' },
          { text: 'Customizing the dashboard', link: '/interface/customize' },
          { text: 'Print files', link: '/interface/print-files' },
          { text: 'Calibration', link: '/interface/calibration' },
          { text: 'History', link: '/interface/history' },
          { text: 'Timelapse', link: '/interface/timelapse' },
          { text: 'Configuration', link: '/interface/configuration' },
          { text: 'Machine', link: '/interface/machine' },
          { text: 'G-code viewer', link: '/interface/gcode-viewer' },
          { text: 'Console', link: '/interface/console' },
          { text: 'Settings', link: '/interface/settings' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Theming', link: '/theming' },
          { text: 'Accessibility', link: '/accessibility' },
          { text: 'Keyboard shortcuts', link: '/shortcuts' },
          { text: 'Development setup', link: '/guide/development' },
          { text: 'Contributing', link: '/contributing' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: repository }],
    editLink: {
      pattern: `${repository}/edit/main/website/:path`,
      text: 'Edit this page on GitHub',
    },
    search: {
      provider: 'local',
    },
    outline: [2, 3],
    footer: {
      message:
        'Alabaster is an independent project and is not affiliated with the Klipper or Moonraker projects.',
    },
  },
})
