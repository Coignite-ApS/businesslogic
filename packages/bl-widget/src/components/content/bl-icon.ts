import { LitElement, html, svg, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

const SIZE_MAP: Record<string, number> = {
  sm: 14,
  md: 18,
  lg: 24,
  xl: 32,
};

// Icon paths — viewBox 24x24
const ICONS: Record<string, string> = {
  'check':          'M20 6L9 17l-5-5',
  'x':              'M18 6L6 18M6 6l12 12',
  'search':         'M11 17a6 6 0 100-12 6 6 0 000 12zm7 2l-3.5-3.5',
  'chevron-right':  'M9 18l6-6-6-6',
  'chevron-down':   'M6 9l6 6 6-6',
  'info':           'M12 2a10 10 0 110 20A10 10 0 0112 2zm0 9v4m0-8v.01',
  'alert-triangle': 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4m0 4h.01',
  'alert-circle':   'M12 2a10 10 0 110 20A10 10 0 0112 2zM12 8v4m0 4h.01',
  'calculator':     'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zm3 5h2m4 0h2M8 12h2m4 0h2M8 16h2m4 0h2',
  'book':           'M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z',
  'file-text':      'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8m8 4H8m2-8H8',
  'plus':           'M12 5v14M5 12h14',
  'minus':          'M5 12h14',
  'star':           'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  'heart':          'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z',
  'external-link':  'M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6m-11 5L21 3',
  'copy':           'M20 9h-9a2 2 0 00-2 2v9a2 2 0 002 2h9a2 2 0 002-2v-9a2 2 0 00-2-2zM5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1',
  'trash':          'M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2',
  'edit':           'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7m-1.5-9.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z',
  'settings':       'M12 15a3 3 0 110-6 3 3 0 010 6zm9-3a9 9 0 01-.1 1.4l2 1.6-2 3.5-2.4-.5a7.2 7.2 0 01-2.4 1.4l-.4 2.5h-4l-.4-2.5A7.2 7.2 0 019 18.5l-2.4.5-2-3.5 2-1.6A9 9 0 015 12a9 9 0 01.1-1.4l-2-1.6 2-3.5 2.4.5a7.2 7.2 0 012.4-1.4L12.5 2h4l.4 2.5a7.2 7.2 0 012.4 1.4l2.4-.5 2 3.5-2 1.6A9 9 0 0121 12z',
  'refresh':        'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15',
  'download':       'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m4-5l5 5 5-5m-5 5V3',
  'upload':         'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m14-7l-5-5-5 5m5-5v12',
  'filter':         'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
  'sort':           'M3 6h18M6 12h12M9 18h6',
  'eye':            'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zm11-3a3 3 0 110 6 3 3 0 010-6z',
  'eye-off':        'M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22',
  'message-circle': 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
  'zap':            'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  'clock':          'M12 2a10 10 0 110 20A10 10 0 0112 2zm0 5v5l4 2',
  'calendar':       'M19 4H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zM16 2v4M8 2v4M3 10h18',
  'user':           'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 3a4 4 0 110 8 4 4 0 010-8z',
  'users':          'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 3a4 4 0 110 8 4 4 0 010-8zm14 18v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  'globe':          'M12 2a10 10 0 110 20A10 10 0 0112 2zm0 0c-2.76 0-5 4.48-5 10s2.24 10 5 10 5-4.48 5-10S14.76 2 12 2zM2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z',
  'link':           'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71',
  'arrow-right':    'M5 12h14m-6-7l7 7-7 7',
  'arrow-left':     'M19 12H5m6 7l-7-7 7-7',
  'arrow-up':       'M12 19V5m7 6l-7-7-7 7',
  'arrow-down':     'M12 5v14m7-6l-7 7-7-7',
  'bar-chart-2':    'M18 20V10M12 20V4M6 20v-6',
  'trending-up':    'M23 6l-9.5 9.5-5-5L1 18M17 6h6v6',
  'trending-down':  'M23 18l-9.5-9.5-5 5L1 6M17 18h6v-6',
  'database':       'M12 2c5.52 0 10 1.79 10 4v12c0 2.21-4.48 4-10 4S2 20.21 2 18V6c0-2.21 4.48-4 10-4zm0 0c5.52 0 10 1.79 10 4M2 6c0 2.21 4.48 4 10 4s10-1.79 10-4M2 12c0 2.21 4.48 4 10 4s10-1.79 10-4',
  'folder':         'M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z',
  'tag':            'M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82zM7 7h.01',
  'hash':           'M4 9h16M4 15h16M10 3l-2 18M16 3l-2 18',
  'at-sign':        'M20 12a8 8 0 01-8 8H8a8 8 0 110-16h4a8 8 0 018 8zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207',
};

@customElement('bl-icon')
export class BlIcon extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
      svg { display: block; }
    `,
  ];

  @property() name = '';
  @property() size: 'sm' | 'md' | 'lg' | 'xl' = 'md';
  @property() color = '';

  render() {
    const px = SIZE_MAP[this.size] ?? 18;
    const stroke = this.color
      ? `var(${this.color}, currentColor)`
      : 'currentColor';
    const path = ICONS[this.name];

    if (!path) {
      // Placeholder square for unknown icons
      return html`
        <svg width=${px} height=${px} viewBox="0 0 24 24" fill="none" stroke=${stroke} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
        </svg>
      `;
    }

    return html`
      <svg width=${px} height=${px} viewBox="0 0 24 24" fill="none" stroke=${stroke} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label=${this.name}>
        <path d=${path}/>
      </svg>
    `;
  }
}
