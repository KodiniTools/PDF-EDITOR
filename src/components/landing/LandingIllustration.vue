<script setup lang="ts">
/**
 * Titelbild der Startseite: stilisierte Ansicht des Editors.
 * Inline-SVG statt Bilddatei, damit die Beschriftung die Oberflächenschrift (Supreme)
 * der Seite nutzt und der Sprache folgt.
 */
import { useI18n } from '@/i18n'

const { t } = useI18n()
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 1440 810"
    width="1440"
    height="810"
    role="img"
    :aria-label="t('landing.imageAlt')"
  >
    <defs>
      <radialGradient id="pdfl-bg" cx="0.85" cy="0" r="1.1">
        <stop offset="0" stop-color="#17435a" />
        <stop offset="0.55" stop-color="#0c1c33" />
        <stop offset="1" stop-color="#08111f" />
      </radialGradient>
      <linearGradient id="pdfl-desk" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#e9eef2" />
        <stop offset="1" stop-color="#d8e4ec" />
      </linearGradient>
      <filter id="pdfl-sh" x="-10%" y="-10%" width="120%" height="130%">
        <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#020812" flood-opacity="0.55" />
      </filter>
      <filter id="pdfl-sh2" x="-10%" y="-10%" width="120%" height="130%">
        <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#13223e" flood-opacity="0.22" />
      </filter>
      <clipPath id="pdfl-win"><rect x="150" y="96" width="1140" height="660" rx="18" /></clipPath>
    </defs>
    <rect width="1440" height="810" fill="url(#pdfl-bg)" />
    <g fill="#8bd8e7" opacity="0.05">
      <circle cx="1260" cy="120" r="220" />
      <circle cx="160" cy="720" r="160" />
    </g>

    <g filter="url(#pdfl-sh)">
      <rect x="150" y="96" width="1140" height="660" rx="18" fill="#f6f5f1" />
    </g>
    <g clip-path="url(#pdfl-win)">
      <rect x="150" y="96" width="1140" height="44" fill="#fbf3df" />
      <circle cx="180" cy="118" r="6" fill="#e0675a" />
      <circle cx="200" cy="118" r="6" fill="#e9b949" />
      <circle cx="220" cy="118" r="6" fill="#6cbf72" />
      <rect x="520" y="107" width="400" height="22" rx="11" fill="#fff" stroke="#e6dcc2" />
      <text x="720" y="123" class="ui" font-size="12" fill="#6a7686" text-anchor="middle">
        kodinitools.com/pdf-editor/app
      </text>

      <rect x="150" y="140" width="1140" height="64" fill="#fff" />
      <line x1="150" y1="204" x2="1290" y2="204" stroke="#d5dbe2" />
      <g class="ui" font-size="14" text-anchor="middle">
        <rect x="172" y="155" width="142" height="34" rx="7" fill="#d9a557" />
        <text x="243" y="177" fill="#2a1a06">{{ t('toolbar.add') }}</text>
        <rect x="326" y="155" width="96" height="34" rx="7" fill="#fff8e8" stroke="#d9a557" />
        <text x="374" y="177" fill="#5a3a10">{{ t('tool.select') }}</text>
        <rect x="430" y="155" width="58" height="34" rx="7" fill="#fff" stroke="#d5dbe2" />
        <text x="459" y="177" fill="#14213a">{{ t('tool.text') }}</text>
        <rect x="496" y="155" width="92" height="34" rx="7" fill="#fff" stroke="#d5dbe2" />
        <text x="542" y="177" fill="#14213a">{{ t('tool.highlight') }}</text>
        <rect x="596" y="155" width="80" height="34" rx="7" fill="#fff" stroke="#d5dbe2" />
        <text x="636" y="177" fill="#14213a">{{ t('tool.signature') }}</text>
        <rect x="684" y="155" width="58" height="34" rx="7" fill="#fff" stroke="#d5dbe2" />
        <text x="713" y="177" fill="#14213a">{{ t('toolbar.image') }}</text>
        <rect x="980" y="155" width="34" height="34" rx="7" fill="#fff" stroke="#d5dbe2" />
        <text x="997" y="177" fill="#14213a">–</text>
        <text x="1040" y="177" fill="#14213a">100%</text>
        <rect x="1066" y="155" width="34" height="34" rx="7" fill="#fff" stroke="#d5dbe2" />
        <text x="1083" y="177" fill="#14213a">+</text>
        <rect x="1156" y="155" width="114" height="34" rx="7" fill="#d9a557" />
        <text x="1213" y="177" fill="#2a1a06">{{ t('toolbar.export') }}</text>
      </g>

      <rect x="150" y="205" width="200" height="560" fill="#fff" />
      <line x1="350" y1="205" x2="350" y2="760" stroke="#d5dbe2" />
      <text x="170" y="236" class="ui" font-size="14" fill="#14213a">{{ t('pages.title') }}</text>
      <text x="330" y="236" class="ui" font-size="13" fill="#48576c" text-anchor="end">3</text>
      <g>
        <rect
          x="166"
          y="252"
          width="168"
          height="156"
          rx="9"
          fill="#fff4dc"
          stroke="#d9a557"
          stroke-width="2"
        />
        <rect x="207" y="262" width="86" height="120" fill="#fff" filter="url(#pdfl-sh2)" />
        <g fill="#aab4c0">
          <rect x="215" y="274" width="50" height="5" />
          <rect x="215" y="288" width="68" height="3" />
          <rect x="215" y="296" width="64" height="3" />
          <rect x="215" y="304" width="66" height="3" />
        </g>
        <rect x="215" y="314" width="62" height="4" fill="#f0c35a" />
        <g fill="#aab4c0">
          <rect x="215" y="324" width="66" height="3" />
          <rect x="215" y="332" width="58" height="3" />
        </g>
        <path d="M250 364c6-8 10 2 16-4s8 4 14-2" stroke="#1b3c8c" stroke-width="1.6" fill="none" />
        <rect x="281" y="264" width="12" height="13" rx="3" fill="#d9a557" />
        <text x="287" y="274" class="ui" font-size="9" fill="#2a1a06" text-anchor="middle">1</text>
        <text x="250" y="398" class="ui" font-size="12" fill="#48576c" text-anchor="middle">
          ↑ ↓ ⟲ ⟳ ×
        </text>
      </g>
      <g>
        <rect x="166" y="420" width="168" height="156" rx="9" fill="#fff" stroke="#d5dbe2" />
        <rect x="207" y="430" width="86" height="120" fill="#fff" filter="url(#pdfl-sh2)" />
        <rect x="215" y="442" width="40" height="30" fill="#c9d6e0" />
        <g fill="#aab4c0">
          <rect x="260" y="444" width="26" height="3" />
          <rect x="260" y="452" width="22" height="3" />
          <rect x="215" y="482" width="68" height="3" />
          <rect x="215" y="490" width="62" height="3" />
          <rect x="215" y="498" width="66" height="3" />
          <rect x="215" y="506" width="54" height="3" />
        </g>
      </g>
      <g>
        <rect x="166" y="588" width="168" height="156" rx="9" fill="#fff" stroke="#d5dbe2" />
        <rect x="207" y="598" width="86" height="120" fill="#fff" filter="url(#pdfl-sh2)" />
        <g fill="#9fb3c4">
          <rect x="222" y="660" width="10" height="30" />
          <rect x="238" y="648" width="10" height="42" />
          <rect x="254" y="636" width="10" height="54" />
          <rect x="270" y="626" width="10" height="64" />
        </g>
        <rect x="215" y="608" width="50" height="5" fill="#aab4c0" />
      </g>

      <rect x="351" y="205" width="940" height="560" fill="url(#pdfl-desk)" />
      <text x="380" y="236" class="ui" font-size="13" fill="#48576c">
        {{ t('desk.status', { n: 1, total: 3 }) }}
      </text>
      <text x="1262" y="236" class="ui" font-size="13" fill="#48576c" text-anchor="end">100 %</text>
      <line x1="380" y1="248" x2="1262" y2="248" stroke="#c4cfd9" />

      <g filter="url(#pdfl-sh2)"><rect x="600" y="268" width="442" height="520" fill="#fff" /></g>
      <g fill="#14213a" font-family="Georgia,serif">
        <text x="640" y="322" font-size="26" font-weight="700">{{ t('landing.sampleTitle') }}</text>
      </g>
      <g fill="#b7c0cb">
        <rect x="640" y="340" width="180" height="7" rx="2" />
        <rect x="640" y="370" width="362" height="6" rx="2" />
        <rect x="640" y="388" width="348" height="6" rx="2" />
        <rect x="640" y="406" width="356" height="6" rx="2" />
        <rect x="640" y="424" width="300" height="6" rx="2" />
      </g>

      <rect x="636" y="448" width="370" height="16" rx="2" fill="#f5cf62" opacity="0.75" />
      <rect x="636" y="468" width="300" height="16" rx="2" fill="#f5cf62" opacity="0.75" />
      <g fill="#7a8796">
        <rect x="640" y="453" width="358" height="6" rx="2" />
        <rect x="640" y="473" width="288" height="6" rx="2" />
      </g>
      <g fill="#b7c0cb">
        <rect x="640" y="502" width="350" height="6" rx="2" />
        <rect x="640" y="520" width="332" height="6" rx="2" />
      </g>

      <rect
        x="632"
        y="546"
        width="300"
        height="58"
        fill="none"
        stroke="#2a6dcb"
        stroke-width="2"
        stroke-dasharray="6 4"
      />
      <text x="644" y="572" class="ui" font-size="17" fill="#1b3c8c">
        {{ t('landing.sampleNote') }}
      </text>
      <text x="644" y="594" class="ui" font-size="14" fill="#48576c">
        {{ t('landing.sampleNoteDetail') }}
      </text>
      <circle cx="932" cy="546" r="9" fill="#d93a3a" />
      <path d="M928 542l8 8M936 542l-8 8" stroke="#fff" stroke-width="2" />
      <rect x="926" y="598" width="12" height="12" rx="2" fill="#2a6dcb" />

      <line x1="640" y1="708" x2="840" y2="708" stroke="#8a96a4" />
      <text x="640" y="726" class="ui" font-size="11" fill="#8a96a4">
        {{ t('landing.sampleSignature') }}
      </text>
      <path
        d="M650 698c10-30 22-38 26-24s-10 30 2 22 18-34 28-26-6 26 6 22 14-18 24-16 4 14 16 10 22-14 36-12"
        stroke="#1b3c8c"
        stroke-width="3"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>

    <g transform="translate(1110 560) rotate(38)">
      <rect x="-12" y="-170" width="24" height="200" rx="11" fill="#3a4250" />
      <rect x="-12" y="-170" width="24" height="18" rx="9" fill="#82531e" />
      <rect x="-12" y="-120" width="24" height="6" fill="#d9a557" />
      <path d="M-12 28 L0 64 L12 28Z" fill="#5a6372" />
      <path d="M-3 54 L0 64 L3 54Z" fill="#1b3c8c" />
    </g>
  </svg>
</template>

<style scoped>
svg {
  display: block;
  width: 100%;
  height: auto;
}

.ui {
  font-family: var(--font-sans);
  font-weight: 400;
}
</style>
