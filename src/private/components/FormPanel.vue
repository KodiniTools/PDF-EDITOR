<script setup lang="ts">
/** Seitenleiste „Formular“ (nur privater Build): Felder ausfüllen, KI-Vorschläge aus Stammdaten. */
import { computed, onMounted, ref, watch } from 'vue'

import { MAX_PROFILE_LENGTH } from '@/private/forms/profile'
import { useFormStore, type FormField } from '@/private/stores/forms'
import { useDocumentStore } from '@/stores/document'

const doc = useDocumentStore()
const forms = useFormStore()
const showProfile = ref(false)
const profileDraft = ref(forms.profile)
const profileNotice = ref<string | null>(null)

const groups = computed(() => {
  const out: { number: number; pageId: string; fields: FormField[] }[] = []
  for (const field of forms.fields) {
    const first = forms.firstPage(field)
    if (!first) continue
    let g = out.find((x) => x.number === first.number)
    if (!g) {
      g = { number: first.number, pageId: first.page.id, fields: [] }
      out.push(g)
    }
    g.fields.push(field)
  }
  return out.sort((a, b) => a.number - b.number)
})

onMounted(() => void forms.detect())
// Seiten hinzugefügt/gelöscht/umsortiert → Felder neu erkennen.
watch(
  () => doc.pages.map((p) => `${p.sourceId}:${p.sourceIndex}`).join(','),
  () => void forms.detect(),
)

function saveProfile(): void {
  const ok = forms.storeProfile(profileDraft.value)
  profileNotice.value = ok
    ? 'Gespeichert (nur in diesem Browser).'
    : 'Browser speichert nicht – gilt nur bis zum Neuladen.'
  showProfile.value = false
}

function onText(field: FormField, e: Event): void {
  forms.setValue(field, (e.target as HTMLInputElement | HTMLTextAreaElement).value)
}

function display(field: FormField, value: string | boolean): string {
  if (field.kind === 'checkbox') return value ? 'angekreuzt' : 'nicht angekreuzt'
  return forms.optionLabel(field, String(value))
}
</script>

<template>
  <section
    class="flex min-h-0 flex-1 flex-col"
    aria-label="Formular ausfüllen"
    data-testid="form-panel"
  >
    <div class="border-b border-gray-200 p-3">
      <p class="text-xs text-gray-500">
        Werte werden beim Export eingetragen und fest in die Seiten übernommen. Für Vorschläge gehen
        Stammdaten, Feldnamen und der Text der Formularseiten an Claude (Anthropic).
      </p>
      <div class="mt-2 flex gap-2">
        <button
          type="button"
          class="pn-btn"
          :aria-expanded="showProfile"
          data-testid="form-profile-toggle"
          @click="showProfile = !showProfile"
        >
          Stammdaten
        </button>
        <button
          type="button"
          class="pn-btn pn-primary flex-1"
          :disabled="forms.busy || forms.fields.length === 0 || !forms.profile.trim()"
          :title="
            forms.profile.trim()
              ? 'Felder mit KI ausfüllen (Strg+Enter)'
              : 'Zuerst Stammdaten hinterlegen'
          "
          data-testid="form-suggest"
          data-shortcut="primary"
          @click="forms.suggest()"
        >
          KI ausfüllen
        </button>
      </div>
      <div v-if="showProfile" class="mt-2">
        <textarea
          v-model="profileDraft"
          rows="8"
          :maxlength="MAX_PROFILE_LENGTH"
          class="w-full rounded-md border border-gray-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
          placeholder="z. B.&#10;Name: Max Mustermann&#10;Geburtsdatum: 01.02.1980&#10;Anschrift: Hauptstr. 5, 10115 Berlin&#10;Telefon: 030 123456&#10;IBAN: DE89 …&#10;Steuer-ID: …"
          aria-label="Stammdaten"
          data-testid="form-profile"
        />
        <div class="mt-1 flex justify-end gap-2">
          <button type="button" class="pn-btn" @click="showProfile = false">Abbrechen</button>
          <button
            type="button"
            class="pn-btn pn-primary"
            data-testid="form-profile-save"
            @click="saveProfile"
          >
            Speichern
          </button>
        </div>
      </div>
      <p v-if="profileNotice" class="mt-2 text-xs text-green-700" role="status">
        {{ profileNotice }}
      </p>
      <div
        v-if="forms.status === 'suggesting'"
        class="mt-2 flex items-center justify-between text-blue-700"
      >
        <span>Claude füllt aus…</span>
        <button type="button" class="underline" @click="forms.cancel()">Abbrechen</button>
      </div>
      <p v-if="forms.status === 'detecting'" class="mt-2 text-blue-700">Suche Formularfelder…</p>
      <p v-if="forms.error" role="alert" class="mt-2 text-red-700">{{ forms.error }}</p>
    </div>

    <div class="min-h-0 flex-1 overflow-auto p-2">
      <p
        v-if="forms.fields.length === 0 && forms.status === 'idle'"
        class="p-2 text-xs text-gray-500"
      >
        Dieses Dokument enthält keine ausfüllbaren Formularfelder.
      </p>
      <section v-for="g in groups" :key="g.number" class="mb-3">
        <button
          type="button"
          class="mb-1 text-xs font-medium text-gray-500 hover:underline"
          @click="doc.selectPage(g.pageId)"
        >
          Seite {{ g.number }}
        </button>
        <div
          v-for="field in g.fields"
          :key="field.key"
          class="mb-2 rounded px-1 py-1"
          :class="{ 'bg-blue-50': field.key in forms.values }"
          data-testid="form-field"
        >
          <label class="block text-xs text-gray-600" :for="`ff-${field.key}`" :title="field.name">
            {{ field.context || field.label }}
            <span v-if="field.context && field.label !== field.context" class="text-gray-400">
              · {{ field.label }}
            </span>
          </label>
          <input
            v-if="field.kind === 'checkbox'"
            :id="`ff-${field.key}`"
            type="checkbox"
            class="mt-1"
            :checked="forms.valueOf(field) === true"
            @change="forms.setValue(field, ($event.target as HTMLInputElement).checked)"
          />
          <select
            v-else-if="field.kind === 'choice' || field.kind === 'radio'"
            :id="`ff-${field.key}`"
            class="mt-1 w-full rounded border border-gray-300 px-1 py-1"
            :value="forms.valueOf(field)"
            @change="forms.setValue(field, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">–</option>
            <option v-for="o in field.options" :key="o" :value="o">
              {{ forms.optionLabel(field, o) }}
            </option>
          </select>
          <textarea
            v-else-if="field.multiline"
            :id="`ff-${field.key}`"
            rows="3"
            class="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            :value="String(forms.valueOf(field))"
            :maxlength="field.maxLength || undefined"
            @input="onText(field, $event)"
          />
          <input
            v-else
            :id="`ff-${field.key}`"
            type="text"
            class="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            :value="String(forms.valueOf(field))"
            :maxlength="field.maxLength || undefined"
            @input="onText(field, $event)"
          />
          <div
            v-if="forms.suggestions[field.key]"
            class="mt-1 flex items-start gap-2 rounded bg-amber-50 px-2 py-1 text-xs"
            data-testid="form-suggestion"
          >
            <span class="min-w-0 flex-1" :title="forms.suggestions[field.key]!.reason">
              Vorschlag: <strong>{{ display(field, forms.suggestions[field.key]!.value) }}</strong>
            </span>
            <button
              type="button"
              class="text-blue-700 underline"
              @click="forms.applySuggestion(field.key)"
            >
              Übernehmen
            </button>
            <button
              type="button"
              class="text-gray-400 hover:text-gray-700"
              :aria-label="`Vorschlag für ${field.label} verwerfen`"
              @click="forms.dismissSuggestion(field.key)"
            >
              ✕
            </button>
          </div>
        </div>
      </section>
      <p v-if="forms.unsupported > 0" class="p-2 text-xs text-gray-500">
        {{ forms.unsupported }} Feld(er) schreibgeschützt oder nicht unterstützt (z. B. Listen,
        Unterschriften).
      </p>
    </div>

    <div
      v-if="forms.suggestionCount > 0 || forms.changedCount > 0"
      class="flex gap-2 border-t border-gray-200 p-3"
    >
      <button
        type="button"
        class="pn-btn"
        :disabled="forms.changedCount === 0"
        @click="forms.resetValues()"
      >
        Zurücksetzen
      </button>
      <button
        type="button"
        class="pn-btn pn-primary flex-1"
        :disabled="forms.suggestionCount === 0"
        data-testid="form-apply-all"
        title="Alle Vorschläge übernehmen (Strg+Alt+Enter)"
        data-shortcut="apply"
        @click="forms.applyAllSuggestions()"
      >
        {{ forms.suggestionCount }} Vorschläge übernehmen
      </button>
    </div>
  </section>
</template>

<style scoped>
@reference 'tailwindcss';

.pn-btn {
  @apply rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50;
}
.pn-primary {
  @apply border-blue-600 bg-blue-600 text-white hover:bg-blue-700;
}
</style>
