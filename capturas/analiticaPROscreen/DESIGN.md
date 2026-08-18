---
name: Kinetic Finance
colors:
  surface: '#f8f9fa'
  surface-dim: '#d9dadb'
  surface-bright: '#f8f9fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f5'
  surface-container: '#edeeef'
  surface-container-high: '#e7e8e9'
  surface-container-highest: '#e1e3e4'
  on-surface: '#191c1d'
  on-surface-variant: '#3c4a42'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f2'
  outline: '#6c7a71'
  outline-variant: '#bbcabf'
  surface-tint: '#006c49'
  primary: '#006c49'
  on-primary: '#ffffff'
  primary-container: '#10b981'
  on-primary-container: '#00422b'
  inverse-primary: '#4edea3'
  secondary: '#575e70'
  on-secondary: '#ffffff'
  secondary-container: '#d9dff5'
  on-secondary-container: '#5c6274'
  tertiary: '#b91a24'
  on-tertiary: '#ffffff'
  tertiary-container: '#ff7a73'
  on-tertiary-container: '#79000e'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#6ffbbe'
  primary-fixed-dim: '#4edea3'
  on-primary-fixed: '#002113'
  on-primary-fixed-variant: '#005236'
  secondary-fixed: '#dce2f7'
  secondary-fixed-dim: '#c0c6db'
  on-secondary-fixed: '#141b2b'
  on-secondary-fixed-variant: '#404758'
  tertiary-fixed: '#ffdad7'
  tertiary-fixed-dim: '#ffb3ad'
  on-tertiary-fixed: '#410004'
  on-tertiary-fixed-variant: '#930013'
  background: '#f8f9fa'
  on-background: '#191c1d'
  surface-variant: '#e1e3e4'
typography:
  display-currency:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 30px
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 26px
  body-lg:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  container-margin: 20px
  gutter: 12px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 24px
  safe-area-bottom: 34px
---

## Brand & Style

This design system is engineered for a high-performance personal financial wellness experience on iOS. The brand personality is disciplined, transparent, and immediate. It prioritizes utility and clarity over decorative flair, adopting an **Ultra-Modern Minimalist** style with a focus on high-contrast data visualization.

The UI should evoke a sense of control and reliability. By utilizing expansive whitespace and a strict structural grid, the interface reduces cognitive load for users managing micro-expenses. Visual hierarchy is established through extreme typographic scaling rather than depth or texture, ensuring the app feels like a native utility.

## Colors

The palette is functional and binary, designed to provide instant feedback on financial health.

- **Background (#F8F9FA):** A neutral, "off-white" foundation that reduces screen glare while maintaining high contrast with text.
- **Typography (#111827):** A deep charcoal used for all primary information to ensure maximum legibility and a premium feel.
- **Emerald Green (#10B981):** Reserved exclusively for positive financial growth, savings targets, and "success" states.
- **Coral (#EF4444):** Used sparingly for alerts, over-budget warnings, and critical deletions.
- **Subtle Accents:** Use a 10% opacity version of the charcoal (#1118271A) for dividers and borders to maintain a lightweight aesthetic.

## Typography

The typography system relies on **Inter** for its neutral, systematic clarity. 

- **Numerical Data:** Use `display-currency` for account balances. Tighten letter spacing to maintain a "monetary" feel.
- **Category Tags:** Always use `label-caps` for transaction categories (e.g., FOOD, TRANSPORT) to differentiate metadata from transactional data.
- **Information Density:** On mobile, prioritize the `headline-md` for card titles to ensure multiple data points fit "above the fold."
- **Contrast:** Maintain a strict contrast ratio of at least 7:1 for all body text against the neutral background.

## Layout & Spacing

The layout follows a **Fluid Mobile Grid** optimized for one-handed ergonomics. 

- **Margins:** A consistent 20px outer margin ensures content does not feel cramped against the bezel.
- **Card Spacing:** Use 12px gutters between cards when displayed in a grid, and 16px vertical stacks for list-based views.
- **One-Hand Ergonomics:** Place primary actions (Add Expense, Filter) within the "natural" thumb zone—the lower 40% of the screen. 
- **Fixed Elements:** The bottom tab bar is fixed with a height of 88px (including safe area) to serve as a persistent anchor.

## Elevation & Depth

This design system avoids traditional shadows and gradients to maintain a "Flat-Plus" aesthetic.

- **Tonal Layering:** Depth is achieved by placing pure white (#FFFFFF) cards on top of the neutral grey (#F8F9FA) background.
- **Outlines:** Use a subtle 1px border (#E5E7EB) on cards instead of shadows to define boundaries.
- **Active States:** When a card or button is pressed, it should scale slightly (98%) rather than casting a shadow, mimicking a physical "press" without visual clutter.

## Shapes

The shape language is friendly yet structured. 

- **Cards & Modals:** Standardized at 16px (`rounded-lg`) to provide a soft, organic feel to financial data.
- **Small Elements:** Checkboxes, input fields, and small tags use 8px (`rounded-md`).
- **Interactive Triggers:** Floating action buttons and main CTA buttons use a full pill-shape (100px) to distinguish them from informational cards.

## Components

- **Cards:** White background, 16px corner radius, 1px light grey border. Content inside should have 16px internal padding.
- **Primary Floating Button:** Emerald Green background with white icon/text. Positioned at the bottom right or center-bottom. No shadow; use high-contrast placement.
- **Input Fields:** Minimalist style. No background; only a 1px bottom border that turns Emerald Green on focus. Labels should use `label-caps`.
- **Chips/Tags:** Used for categories. Light grey background (#F3F4F6) with `label-caps` text.
- **Progress Bars:** Use a thick 8px track. The background of the track should be a 10% opacity of the charcoal, while the fill is Emerald Green.
- **Bottom Tab Bar:** Blur-free, solid white background with a 1px top divider. Icons should be 24px stroke-based (linear) for a lightweight look.
- **Transaction Lists:** Minimal dividers (1px width, 10% opacity charcoal). Avoid chevrons; use spacing and typographic weight to imply tapability.