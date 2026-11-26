<script setup lang="ts">
import { TEXT_LINE_HEIGHT } from '@/lib/geometry'
import { cssFontFamily } from '@/lib/textLayout'
import { HIGHLIGHT_OPACITY } from '@/services/pdfExport'
import type { Annotation, Size } from '@/types/pdf'

/**
 * Nur lesende Darstellung der Annotationen einer Seite, so wie der Export sie zeichnet
 * (z. B. für die Seitenminiaturen). Koordinaten in Punkten im angezeigten Seitenraum.
 *
 * Die Ebene ist ein SVG mit `viewBox` in Seitenpunkten und `preserveAspectRatio="meet"`:
 * Sie skaliert dadurch exakt wie die darunterliegende Canvas – auch wenn CSS deren Höhe
 * begrenzt (`object-fit: contain`). Der Inhalt ist HTML (foreignObject), damit Text
 * dieselben Stilregeln nutzt wie im Editor.
 */
defineProps<{
  /** Angezeigte (gedrehte) Seitengröße in Punkten. */
  size: Size
  annotations: readonly Annotation[]
}>()

function pt(v: number): string {
  return `${v}px`
}
</script>

<template>
  <svg
    class="pointer-events-none absolute inset-0 h-full w-full"
    :viewBox="`0 0 ${size.width} ${size.height}`"
    preserveAspectRatio="xMidYMid meet"
    aria-hidden="true"
    data-testid="annotation-preview"
  >
    <foreignObject x="0" y="0" :width="size.width" :height="size.height">
      <div
        class="relative overflow-hidden"
        :style="{ width: pt(size.width), height: pt(size.height) }"
      >
        <template v-for="a in annotations" :key="a.id">
          <!-- Abdeckung / Schwärzung: im Export immer deckend -->
          <div
            v-if="a.kind === 'cover'"
            class="absolute"
            :style="{
              left: pt(a.x),
              top: pt(a.y),
              width: pt(a.width),
              height: pt(a.height),
              backgroundColor: a.color,
            }"
            data-kind="cover"
          />
          <div
            v-else-if="a.kind === 'highlight'"
            class="absolute"
            :style="{
              left: pt(a.x),
              top: pt(a.y),
              width: pt(a.width),
              height: pt(a.height),
              backgroundColor: a.color,
              opacity: HIGHLIGHT_OPACITY,
            }"
            data-kind="highlight"
          />
          <img
            v-else-if="a.kind === 'image'"
            :src="a.dataUrl"
            alt=""
            class="absolute block max-w-none"
            :style="{ left: pt(a.x), top: pt(a.y), width: pt(a.width), height: pt(a.height) }"
            draggable="false"
            data-kind="image"
          />
          <div
            v-else-if="a.kind === 'text'"
            class="absolute whitespace-pre"
            :style="{
              left: pt(a.x),
              top: pt(a.y),
              color: a.color,
              fontSize: pt(a.fontSize),
              lineHeight: String(TEXT_LINE_HEIGHT),
              fontFamily: cssFontFamily(a.font),
              fontWeight: a.bold ? 'bold' : 'normal',
              fontStyle: a.italic ? 'italic' : 'normal',
              textAlign: a.align ?? 'left',
            }"
            data-kind="text"
          >
            <span class="block">{{ a.text }}</span>
          </div>
        </template>
      </div>
    </foreignObject>
  </svg>
</template>
