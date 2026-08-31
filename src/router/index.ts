import { createRouter, createWebHashHistory } from 'vue-router'

import { pageComponent } from '@/router/pages'

/*
 * Routes carry no metadata on purpose.
 *
 * They used to declare `availabilityRequirement` and `titleKey`, and nothing
 * ever read either: there is no navigation guard, and no code sets the document
 * title. Availability is declared where it is enforced — per region, by
 * `AvailabilityRegion` and `useAvailability`, which is finer than a route
 * because one page mixes regions with different requirements (ADR 0002). A
 * route's label already lives in `src/navigation/destinations.ts`, which the
 * rail actually renders.
 *
 * Left in place the pair read as a working mechanism, so the next change to
 * route-level gating would have extended something inert.
 */

/*
 * Every route's component comes from `pageComponent`, and none of them is a
 * `() => import(...)` loader. That is the difference between a navigation the
 * router commits now and one it commits when the network answers — see
 * `pages.ts`, which holds why and what stands in meanwhile.
 */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'overview',
      component: pageComponent('overview'),
    },
    {
      path: '/farm',
      name: 'farm',
      component: pageComponent('farm'),
    },
    {
      path: '/print-files',
      name: 'printFiles',
      component: pageComponent('printFiles'),
    },
    {
      path: '/console',
      name: 'console',
      component: pageComponent('console'),
    },
    {
      path: '/history',
      name: 'history',
      component: pageComponent('history'),
    },
    {
      path: '/timelapse',
      name: 'timelapse',
      component: pageComponent('timelapse'),
    },
    {
      path: '/calibration',
      name: 'calibration',
      component: pageComponent('calibration'),
    },
    {
      path: '/configuration',
      name: 'configuration',
      component: pageComponent('configuration'),
    },
    /*
     * The destination was called File Explorer until it grew past browsing the
     * config root. A bookmark or a pasted link to the old hash would otherwise
     * land on nothing at all, since this router has no catch-all.
     */
    {
      path: '/file-explorer',
      redirect: { name: 'configuration' },
    },
    {
      path: '/machine',
      name: 'machine',
      component: pageComponent('machine'),
    },
    {
      path: '/gcode-viewer',
      name: 'gcodeViewer',
      component: pageComponent('gcodeViewer'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: pageComponent('settings'),
    },
  ],
})
