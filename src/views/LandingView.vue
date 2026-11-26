<script setup lang="ts">
/**
 * Startseite der öffentlichen Variante (`/pdf-editor/`). Der Editor liegt unter `/app`.
 * Maße, Farben und Button entsprechen der Startseite des Audio Normalizers
 * (KodiniTools/Audio-Normalizer, tokens-v2 + kodini-layout-stage1).
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { RouterLink } from 'vue-router'

import LandingIllustration from '@/components/landing/LandingIllustration.vue'
import { useI18n, type MessageKey } from '@/i18n'

const { t } = useI18n()

/** Titel zweifarbig: „PDF-“ / „PDF “ in Gold, der Rest in Blau. */
const titleParts = computed(() => {
  const title = t('app.title')
  const match = /^PDF[-\s]?/.exec(title)
  const pdf = match?.[0] ?? ''
  return { pdf, rest: title.slice(pdf.length) }
})

const features: { title: MessageKey; desc: MessageKey }[] = [
  { title: 'landing.feature1Title', desc: 'landing.feature1Desc' },
  { title: 'landing.feature2Title', desc: 'landing.feature2Desc' },
  { title: 'landing.feature3Title', desc: 'landing.feature3Desc' },
]

/** Die Startseite scrollt als Ganzes; der Editor füllt dagegen genau den Bildschirm (main.css). */
const SCROLL_CLASS = 'pdf-landing-active'
onMounted(() => document.documentElement.classList.add(SCROLL_CLASS))
onBeforeUnmount(() => document.documentElement.classList.remove(SCROLL_CLASS))
</script>

<template>
  <div class="pdf-landing">
    <div class="landing-nav">
      <div class="landing-container landing-nav-inner">
        <RouterLink :to="{ name: 'landing' }" class="landing-brand">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <path d="M14 3v6h6" />
            <path d="M8 14l6-6 2 2-6 6H8z" />
          </svg>
          <span class="landing-brand-text">{{ t('app.title') }}</span>
        </RouterLink>
        <nav class="landing-tabs" :aria-label="t('landing.navLabel')">
          <RouterLink :to="{ name: 'landing' }" class="landing-tab">
            {{ t('landing.home') }}
          </RouterLink>
          <RouterLink :to="{ name: 'editor' }" class="landing-tab" data-testid="landing-tab-editor">
            {{ t('landing.editor') }}
          </RouterLink>
        </nav>
      </div>
    </div>

    <main>
      <section class="landing-hero">
        <div class="landing-container landing-hero-grid">
          <div>
            <h1 class="landing-title">
              <span class="landing-title-pdf">{{ titleParts.pdf }}</span
              >{{ titleParts.rest }}
            </h1>
            <p class="landing-subtitle">{{ t('landing.subtitle') }}</p>
            <p class="landing-description">{{ t('landing.description') }}</p>
            <RouterLink :to="{ name: 'editor' }" class="landing-cta" data-testid="landing-cta">
              {{ t('landing.cta') }} →
            </RouterLink>
          </div>
          <figure class="landing-media">
            <LandingIllustration />
          </figure>
        </div>
      </section>

      <section class="landing-features" aria-labelledby="landing-features-title">
        <div class="landing-container">
          <h2 id="landing-features-title" class="landing-section-title">
            {{ t('landing.featuresTitle') }}
          </h2>
          <div class="landing-features-grid">
            <article v-for="f in features" :key="f.title" class="landing-card">
              <h3>{{ t(f.title) }}</h3>
              <p>{{ t(f.desc) }}</p>
            </article>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
/* Werte aus tokens-v2 des Audio Normalizers (Dark = Standard, Light über data-theme). */
.pdf-landing {
  --ds-surface-0: #0a1324;
  --ds-surface-1: #111d33;
  --ds-surface-2: #182741;
  --ds-border: #223553;
  --ds-border-strong: #2f4668;
  --ds-text: #f2eee2;
  --ds-text-2: #a7b3c4;
  --ds-accent: #d4a257;
  --ds-accent-soft: rgba(212, 162, 87, 0.14);
  --ds-on-accent: #ffffff;
  --ds-glow-blue: rgba(55, 114, 202, 0.2);
  --ds-glow-cyan: rgba(38, 167, 187, 0.16);
  --ds-heading-accent: #69d7e9;
  /* Titelfarben aus dem KodiniTools-Logo */
  --landing-title-gold: #e6bc76;
  --landing-title-blue: #48a0d8;
  --ds-shadow-overlay: 0 8px 24px rgba(0, 0, 0, 0.35);
  --ds-accent-fill-grad: linear-gradient(180deg, #9c6c26 0%, #7a5218 45%, #4a2f0a 100%);
  --ds-accent-fill-grad-hover: linear-gradient(180deg, #8c5f1f 0%, #6a4614 45%, #402908 100%);
  --ds-ease: cubic-bezier(0.2, 0, 0, 1);
  --landing-width: 1160px;
  --landing-gutter: clamp(12px, 3vw, 24px);

  min-height: 100%;
  color: var(--ds-text);
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
  background-color: var(--ds-surface-0);
  background-image:
    radial-gradient(ellipse at 85% 0%, var(--ds-glow-cyan), transparent 68%),
    radial-gradient(ellipse at 12% 0%, var(--ds-glow-blue), transparent 62%);
  background-repeat: no-repeat;
  background-size: 100% 42rem;
}

:root[data-theme='light'] .pdf-landing {
  --ds-surface-0: #f6f5f1;
  --ds-surface-1: #ffffff;
  --ds-surface-2: #f0eee8;
  --ds-border: #e2dfd7;
  --ds-border-strong: #cbc6ba;
  --ds-text: #14213a;
  --ds-text-2: #3f4a60;
  --ds-accent: #8f6320;
  --ds-accent-soft: rgba(201, 152, 77, 0.16);
  --ds-glow-blue: rgba(86, 147, 216, 0.15);
  --ds-glow-cyan: rgba(35, 162, 195, 0.16);
  --ds-heading-accent: #086a80;
  --landing-title-gold: #775115;
  --landing-title-blue: #0058a0;
  --ds-shadow-overlay: 0 8px 24px rgba(20, 33, 58, 0.12);
}

@media (prefers-color-scheme: light) {
  :root:not([data-theme]) .pdf-landing {
    --ds-surface-0: #f6f5f1;
    --ds-surface-1: #ffffff;
    --ds-surface-2: #f0eee8;
    --ds-border: #e2dfd7;
    --ds-border-strong: #cbc6ba;
    --ds-text: #14213a;
    --ds-text-2: #3f4a60;
    --ds-accent: #8f6320;
    --ds-accent-soft: rgba(201, 152, 77, 0.16);
    --ds-glow-blue: rgba(86, 147, 216, 0.15);
    --ds-glow-cyan: rgba(35, 162, 195, 0.16);
    --ds-heading-accent: #086a80;
    --landing-title-gold: #775115;
    --landing-title-blue: #0058a0;
    --ds-shadow-overlay: 0 8px 24px rgba(20, 33, 58, 0.12);
  }
}

.landing-container {
  max-width: var(--landing-width);
  margin-inline: auto;
  padding-inline: var(--landing-gutter);
}

/* Lokale Leiste (Muster: HeroNav des Normalizers) */
.landing-nav {
  background: var(--ds-surface-1);
  border-bottom: 1px solid var(--ds-border-strong);
}

.landing-nav-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 56px;
}

.landing-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  font-size: 16px;
  letter-spacing: -0.01em;
  color: var(--ds-text);
  text-decoration: none;
}

.landing-brand svg {
  color: var(--ds-accent);
}

.landing-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 4px;
}

.landing-tab {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  color: var(--ds-text-2);
  font-size: 14px;
  white-space: nowrap;
  text-decoration: none;
  transition:
    color 150ms var(--ds-ease),
    background-color 150ms var(--ds-ease);
}

.landing-tab:hover {
  color: var(--ds-text);
  background: var(--ds-surface-2);
}

.landing-tab[aria-current='page'] {
  color: var(--ds-text);
  background: var(--ds-accent-soft);
  border-color: var(--ds-accent);
}

/* Hero */
.landing-hero {
  padding-block: clamp(32px, 7vw, 6rem) clamp(32px, 5vw, 4rem);
}

.landing-hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  align-items: center;
  gap: clamp(24px, 5vw, 64px);
}

.landing-title {
  margin: 0 0 12px;
  color: var(--landing-title-blue);
  font-size: clamp(2.25rem, 5.25vw, 4.5rem);
  font-weight: 400;
  line-height: 1.05;
  letter-spacing: -0.045em;
  overflow-wrap: anywhere;
  text-wrap: balance;
}

.landing-title-pdf {
  color: var(--landing-title-gold);
}

.landing-subtitle {
  margin: 0 0 12px;
  color: var(--ds-heading-accent);
  font-size: 16px;
}

.landing-description {
  margin: 0 0 24px;
  color: var(--ds-text-2);
  font-size: 14px;
}

.landing-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  padding: 0 20px;
  border-radius: 10px;
  background: var(--ds-accent-fill-grad);
  color: var(--ds-on-accent);
  font-size: 16px;
  text-decoration: none;
}

.landing-cta:hover {
  background: var(--ds-accent-fill-grad-hover);
  color: var(--ds-on-accent);
}

.landing-media {
  max-width: 800px;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--ds-border-strong);
  border-radius: 16px;
  background: var(--ds-surface-2);
  box-shadow: var(--ds-shadow-overlay);
}

/* Funktionen */
.landing-features {
  padding-block: clamp(32px, 5vw, 64px);
  background: var(--ds-surface-1);
  border-block: 1px solid var(--ds-border);
}

.landing-section-title {
  margin: 0 0 32px;
  font-size: 24px;
  font-weight: 400;
  line-height: 1.25;
  letter-spacing: -0.01em;
  text-align: center;
}

.landing-features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
  gap: 20px;
}

.landing-card {
  padding: 20px;
  border: 1px solid var(--ds-border);
  border-radius: 16px;
  background: linear-gradient(150deg, var(--ds-surface-1), var(--ds-surface-0));
  transition: border-color 150ms var(--ds-ease);
}

.landing-card:hover {
  border-color: var(--ds-border-strong);
}

.landing-card h3 {
  margin: 0 0 8px;
  color: var(--ds-text);
  font-size: 16px;
  font-weight: 400;
  line-height: 1.25;
}

.landing-card p {
  margin: 0;
  color: var(--ds-text-2);
  font-size: 14px;
}

.landing-brand:focus-visible,
.landing-tab:focus-visible,
.landing-cta:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--ds-surface-0),
    0 0 0 4px var(--ds-accent);
}

@media (max-width: 760px) {
  .landing-hero-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 600px) {
  .landing-brand-text {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}

@media (max-width: 480px) {
  .landing-cta {
    width: 100%;
    max-width: 320px;
    height: 44px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .landing-tab,
  .landing-card {
    transition: none;
  }
}
</style>
