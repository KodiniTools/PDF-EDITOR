import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'

import Anthropic from '@anthropic-ai/sdk'

import { askDocument, buildAskParams } from '../ask.ts'
import { createHandler, toHttpError } from '../app.ts'
import { buildFormParams, sanitizeSuggestions, suggestFormValues } from '../forms.ts'
import { buildGenerateParams, generateDocument, sanitizeDocument } from '../generate.ts'
import { buildOcrParams, recognizePage, sanitizeOcr } from '../ocr.ts'
import { buildRewriteParams, rewriteText, sanitizeRewrite } from '../rewrite.ts'
import { ConfigError, DEFAULT_PORT, loadConfig } from '../config.ts'
import {
  buildParams,
  sanitizeFindings,
  SuggestError,
  suggestRedactions,
  type StreamFn,
} from '../suggest.ts'
import {
  parseAskRequest,
  parseFormRequest,
  parseGenerateRequest,
  parseModel,
  parseOcrRequest,
  parseRewriteRequest,
  parseSuggestRequest,
  ValidationError,
} from '../validate.ts'

type BetaMessage = Anthropic.Beta.Messages.BetaMessage

const REQ = {
  pages: [
    { page: 1, lines: ['Rechnung an', 'Max Mustermann', 'IBAN: DE89 3704 0044 0532 0130 00'] },
    { page: 2, lines: ['Mit freundlichen Grüßen', 'Erika Musterfrau'] },
  ],
}

function message(text: string, stop_reason: BetaMessage['stop_reason'] = 'end_turn'): BetaMessage {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text, citations: null }],
    stop_reason,
    stop_sequence: null,
    stop_details: null,
    usage: {} as BetaMessage['usage'],
  } as unknown as BetaMessage
}

function fakeStream(result: BetaMessage | Error, seen?: { params?: unknown }): StreamFn {
  return (params) => {
    if (seen) seen.params = params
    return {
      finalMessage: async () => {
        if (result instanceof Error) throw result
        return result
      },
    }
  }
}

describe('Modellauswahl', () => {
  it('Standard-Allowlist mit Standardmodell vorne', () => {
    const c = loadConfig({ ANTHROPIC_API_KEY: 'k' })
    assert.deepEqual(c.models, [
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
      'claude-fable-5-2',
    ])
  })
  it('ANTHROPIC_MODELS ergänzt das Standardmodell und prüft IDs', () => {
    const c = loadConfig({
      ANTHROPIC_API_KEY: 'k',
      ANTHROPIC_MODEL: 'claude-sonnet-5-5',
      ANTHROPIC_MODELS: ' claude-haiku-5-5 , claude-opus-5-5 ',
    })
    assert.deepEqual(c.models, ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'])
    assert.throws(
      () => loadConfig({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODELS: 'gpt-4' }),
      /ANTHROPIC_MODELS/,
    )
    assert.throws(() => loadConfig({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'x y' }), /MODEL/)
  })
  it('parseModel: Standard, Allowlist, Fehler', () => {
    const allowed = ['claude-opus-5-5', 'claude-haiku-5-5']
    assert.equal(parseModel({}, allowed, 'claude-opus-5-5'), 'claude-opus-5-5')
    assert.equal(parseModel(null, allowed, 'claude-opus-5-5'), 'claude-opus-5-5')
    assert.equal(parseModel({ model: 'claude-haiku-5-5' }, allowed, 'x'), 'claude-haiku-5-5')
    assert.throws(() => parseModel({ model: 'claude-fable-5-2' }, allowed, 'x'), ValidationError)
    assert.throws(() => parseModel({ model: 1 }, allowed, 'x'), ValidationError)
  })
})

describe('Neues Dokument', () => {
  const GEN = { prompt: ' Rechnungsvorlage ', format: 'Letter', orientation: 'portrait' }
  it('parseGenerateRequest prüft Eingaben', () => {
    assert.deepEqual(parseGenerateRequest(GEN), {
      prompt: 'Rechnungsvorlage',
      format: 'Letter',
      orientation: 'portrait',
      language: 'de',
    })
    assert.throws(() => parseGenerateRequest({ ...GEN, prompt: ' ' }), ValidationError)
    assert.throws(() => parseGenerateRequest({ ...GEN, format: 'B5' }), /format/)
    assert.throws(() => parseGenerateRequest({ ...GEN, orientation: 'quer' }), /orientation/)
    assert.throws(() => parseGenerateRequest({ ...GEN, language: 'xx' }), /language/)
    for (const language of ['hr', 'bs', 'it', 'es', 'de']) {
      assert.equal(parseGenerateRequest({ ...GEN, language }).language, language)
    }
    assert.throws(
      () => parseGenerateRequest({ ...GEN, prompt: 'x'.repeat(4_001) }),
      (err: unknown) => err instanceof ValidationError && err.status === 413,
    )
  })
  it('buildGenerateParams: Format, Sprache, Schema, kein Fallback', () => {
    const p = buildGenerateParams(
      { prompt: 'Vorlage', format: 'A3', orientation: 'landscape', language: 'en' },
      { model: 'claude-haiku-5-5', effort: 'medium' },
    )
    assert.equal(p.model, 'claude-haiku-5-5')
    assert.equal('fallbacks' in p, false)
    assert.equal(p.output_config?.format?.type, 'json_schema')
    const content = p.messages[0]?.content
    assert.ok(typeof content === 'string' && content.includes('DIN A3, Querformat'))
    assert.ok(typeof content === 'string' && content.includes('Sprache: Englisch'))
  })
  it('sanitizeDocument verwirft Ungültiges und gleicht Tabellen an', () => {
    const doc = sanitizeDocument({
      title: '  Mein\nTitel ',
      blocks: [
        { type: 'heading', level: 7, text: 'Kopf' },
        { type: 'paragraph', text: '   ' },
        { type: 'bullets', items: ['a', '', 3] },
        { type: 'table', rows: [['A', 'B', 'C'], ['1'], 'kaputt'], header: true },
        { type: 'table', rows: [] },
        { type: 'bild', text: 'x' },
        { type: 'field', text: 'Name' },
        { type: 'pagebreak' },
      ],
    })
    assert.equal(doc.title, 'Mein Titel')
    assert.deepEqual(doc.blocks, [
      { type: 'heading', level: 2, text: 'Kopf' },
      { type: 'bullets', items: ['a'] },
      {
        type: 'table',
        rows: [
          ['A', 'B', 'C'],
          ['1', '', ''],
        ],
        header: true,
      },
      { type: 'field', text: 'Name' },
      { type: 'pagebreak' },
    ])
    assert.throws(() => sanitizeDocument({ title: 'x', blocks: [] }), SuggestError)
    assert.throws(() => sanitizeDocument({}), SuggestError)
    assert.equal(sanitizeDocument({ blocks: [{ type: 'divider' }] }).title, 'Neues Dokument')
  })
  it('generateDocument: Ablehnung → 422 (kein Modellwechsel)', async () => {
    await assert.rejects(
      generateDocument(
        fakeStream(message('', 'refusal')),
        { prompt: 'x', format: 'A4', orientation: 'portrait', language: 'de' },
        { model: 'claude-opus-5-5', effort: 'medium', signal: new AbortController().signal },
      ),
      (err: unknown) => err instanceof SuggestError && err.status === 422,
    )
  })
})

describe('loadConfig', () => {
  it('verlangt einen API-Key', () => {
    assert.throws(() => loadConfig({}), ConfigError)
  })
  it('setzt sichere Standardwerte', () => {
    const c = loadConfig({ ANTHROPIC_API_KEY: 'sk-test' })
    assert.equal(c.port, DEFAULT_PORT)
    assert.equal(c.host, '127.0.0.1')
    assert.equal(c.model, 'claude-opus-5-5')
    assert.equal(c.effort, 'medium')
  })
  it('prüft Port und Effort', () => {
    assert.throws(() => loadConfig({ ANTHROPIC_API_KEY: 'k', PORT: '80' }), /PORT/)
    assert.throws(() => loadConfig({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_EFFORT: 'turbo' }), /EFFORT/)
    assert.equal(loadConfig({ ANTHROPIC_API_KEY: 'k', PORT: '3999' }).port, 3999)
  })
})

describe('parseSuggestRequest', () => {
  it('akzeptiert gültige Anfragen', () => {
    assert.deepEqual(parseSuggestRequest(REQ, 10_000), REQ)
  })
  it('lehnt ungültige Formen ab', () => {
    for (const bad of [
      null,
      {},
      { pages: [] },
      { pages: [{ page: 0, lines: [] }] },
      { pages: [{ page: 1, lines: [1] }] },
    ]) {
      assert.throws(() => parseSuggestRequest(bad, 10_000), ValidationError)
    }
    assert.throws(
      () =>
        parseSuggestRequest(
          {
            pages: [
              { page: 1, lines: [] },
              { page: 1, lines: [] },
            ],
          },
          10_000,
        ),
      /doppelt/,
    )
  })
  it('begrenzt die Textmenge mit 413', () => {
    assert.throws(
      () => parseSuggestRequest(REQ, 20),
      (err: unknown) => err instanceof ValidationError && err.status === 413,
    )
  })
})

describe('buildParams', () => {
  it('nutzt Modell, Effort und JSON-Schema – ohne Fallback auf andere Modelle', () => {
    const p = buildParams(REQ, { model: 'claude-opus-5-5', effort: 'medium' })
    assert.equal(p.model, 'claude-opus-5-5')
    assert.equal('fallbacks' in p, false)
    assert.equal('betas' in p, false)
    assert.equal(p.output_config?.effort, 'medium')
    assert.equal(p.output_config?.format?.type, 'json_schema')
    const content = p.messages[0]?.content
    assert.ok(
      typeof content === 'string' &&
        content.includes('<page number="2">\nMit freundlichen Grüßen\nErika Musterfrau\n</page>'),
    )
  })
})

describe('sanitizeFindings', () => {
  it('verwirft erfundene, doppelte und seitenfremde Treffer', () => {
    const out = sanitizeFindings(
      {
        findings: [
          { page: 1, text: 'Max Mustermann', category: 'name', reason: 'Name' },
          { page: 1, text: 'max  mustermann', category: 'name', reason: 'doppelt' },
          { page: 1, text: 'Erika Musterfrau', category: 'name', reason: 'falsche Seite' },
          { page: 3, text: 'Max Mustermann', category: 'name', reason: 'unbekannte Seite' },
          { page: 1, text: 'Hans Gibtsnicht', category: 'name', reason: 'erfunden' },
          { page: 1, text: 'DE89 3704 0044 0532 0130 00', category: 'quatsch', reason: '' },
          { page: 2, text: 'Erika Musterfrau', category: 'name' },
        ],
      },
      REQ,
    )
    assert.deepEqual(
      out.map((f) => [f.page, f.text, f.category]),
      [
        [1, 'Max Mustermann', 'name'],
        [1, 'DE89 3704 0044 0532 0130 00', 'other'],
        [2, 'Erika Musterfrau', 'name'],
      ],
    )
  })
  it('liefert bei unbrauchbarer Struktur eine leere Liste', () => {
    assert.deepEqual(sanitizeFindings('x', REQ), [])
    assert.deepEqual(sanitizeFindings({ findings: 'x' }, REQ), [])
  })
})

describe('suggestRedactions', () => {
  const opts = { model: 'm', effort: 'medium' as const, signal: new AbortController().signal }

  it('liest das JSON aus dem Textblock', async () => {
    const json = JSON.stringify({
      findings: [{ page: 2, text: 'Erika Musterfrau', category: 'name', reason: 'Name' }],
    })
    const out = await suggestRedactions(fakeStream(message(json)), REQ, opts)
    assert.deepEqual(out, [{ page: 2, text: 'Erika Musterfrau', category: 'name', reason: 'Name' }])
  })
  it('meldet Ablehnung und abgeschnittene Antworten', async () => {
    await assert.rejects(
      suggestRedactions(fakeStream(message('', 'refusal')), REQ, opts),
      (e: unknown) => e instanceof SuggestError && e.status === 422,
    )
    await assert.rejects(
      suggestRedactions(fakeStream(message('{"findings":[', 'max_tokens')), REQ, opts),
      /zu lang/,
    )
    await assert.rejects(
      suggestRedactions(fakeStream(message('kein json')), REQ, opts),
      /nicht lesbar/,
    )
  })
})

const ASK = {
  ...REQ,
  messages: [
    { role: 'user', content: 'Wer ist der Empfänger?' },
    { role: 'assistant', content: 'Max Mustermann (S. 1)' },
    { role: 'user', content: 'Und der Absender?' },
  ],
}

describe('parseAskRequest', () => {
  it('akzeptiert einen Gesprächsverlauf', () => {
    const r = parseAskRequest(ASK, 10_000)
    assert.equal(r.messages.length, 3)
    assert.equal(r.pages.length, 2)
  })
  it('verlangt abwechselnde Rollen, Frage am Ende und Text', () => {
    const bad = [
      { ...REQ, messages: [] },
      { ...REQ, messages: [{ role: 'assistant', content: 'x' }] },
      {
        ...REQ,
        messages: [
          { role: 'user', content: 'a' },
          { role: 'user', content: 'b' },
        ],
      },
      {
        ...REQ,
        messages: [
          { role: 'user', content: 'a' },
          { role: 'assistant', content: 'b' },
        ],
      },
      { ...REQ, messages: [{ role: 'user', content: '  ' }] },
      { ...REQ, messages: [{ role: 'user', content: 'x'.repeat(4001) }] },
      { ...REQ, messages: [{ role: 'system', content: 'x' }] },
      { messages: [{ role: 'user', content: 'x' }] },
    ]
    for (const b of bad) assert.throws(() => parseAskRequest(b, 10_000), ValidationError)
  })
})

describe('buildAskParams / askDocument', () => {
  it('cacht den Dokumenttext im ersten Turn und hängt den Verlauf an', () => {
    const p = buildAskParams(parseAskRequest(ASK, 10_000), {
      model: 'claude-opus-5-5',
      effort: 'medium',
    })
    assert.equal(p.model, 'claude-opus-5-5')
    assert.equal(p.messages.length, 3)
    const first = p.messages[0]?.content as {
      type: string
      text: string
      cache_control?: unknown
    }[]
    assert.match(first[0]?.text ?? '', /<page number="1">/)
    assert.deepEqual(first[0]?.cache_control, { type: 'ephemeral' })
    assert.equal(first[1]?.text, 'Wer ist der Empfänger?')
    assert.equal(first[1]?.cache_control, undefined)
    assert.deepEqual(p.messages[2], { role: 'user', content: 'Und der Absender?' })
  })
  it('liefert die Antwort als Text', async () => {
    const answer = await askDocument(
      fakeStream(message('  Erika Musterfrau (S. 2)\n')),
      parseAskRequest(ASK, 10_000),
      { model: 'm', effort: 'medium', signal: new AbortController().signal },
    )
    assert.equal(answer, 'Erika Musterfrau (S. 2)')
  })
})

describe('rewrite', () => {
  const OPTS = { model: 'claude-opus-5-5', effort: 'medium' as const }

  it('validiert Modus, Sprache und Länge', () => {
    assert.deepEqual(parseRewriteRequest({ text: 'Hallo', mode: 'correct' }), {
      text: 'Hallo',
      mode: 'correct',
      singleLine: false,
    })
    assert.equal(
      parseRewriteRequest({ text: 'Hallo', mode: 'translate', language: 'en', singleLine: true })
        .language,
      'en',
    )
    for (const bad of [
      null,
      { text: ' ', mode: 'correct' },
      { text: 'x', mode: 'hack' },
      { text: 'x', mode: 'translate' },
      { text: 'x', mode: 'translate', language: 'zh' },
      { text: 'x', mode: 'correct', singleLine: 'ja' },
    ]) {
      assert.throws(() => parseRewriteRequest(bad), ValidationError)
    }
    assert.throws(
      () => parseRewriteRequest({ text: 'x'.repeat(4001), mode: 'correct' }),
      (e: unknown) => e instanceof ValidationError && e.status === 413,
    )
  })

  it('baut die Anweisung je Modus', () => {
    const p = buildRewriteParams(
      { text: 'Hallo Welt', mode: 'translate', language: 'fr', singleLine: true },
      OPTS,
    )
    const content = String(p.messages[0]?.content)
    assert.match(content, /Französisch/)
    assert.match(content, /genau einer Zeile/)
    assert.match(content, /<text>\nHallo Welt\n<\/text>/)
    assert.equal(p.output_config?.effort, 'low')
    assert.equal(p.output_config?.format?.type, 'json_schema')
    const plain = buildRewriteParams({ text: 'x', mode: 'formal', singleLine: false }, OPTS)
    assert.doesNotMatch(String(plain.messages[0]?.content), /genau einer Zeile/)
  })

  it('bereinigt das Ergebnis', () => {
    const req = { text: 'Hallo Welt', mode: 'correct' as const, singleLine: true }
    assert.equal(sanitizeRewrite({ text: ' Hallo\r\n Welt ' }, req), 'Hallo Welt')
    assert.equal(sanitizeRewrite({ text: 'a\nb' }, { ...req, singleLine: false }), 'a\nb')
    assert.throws(() => sanitizeRewrite({ text: '  ' }, req), SuggestError)
    assert.throws(() => sanitizeRewrite({ text: 'x'.repeat(500) }, req), SuggestError)
    assert.throws(() => sanitizeRewrite({}, req), SuggestError)
  })

  it('liefert den neuen Text', async () => {
    const out = await rewriteText(
      fakeStream(message(JSON.stringify({ text: 'Hello world' }))),
      { text: 'Hallo Welt', mode: 'translate', language: 'en', singleLine: false },
      { ...OPTS, signal: new AbortController().signal },
    )
    assert.equal(out, 'Hello world')
  })
})

const IMAGE = { image: 'A'.repeat(200), mediaType: 'image/jpeg', width: 1000, height: 1400 }

describe('ocr', () => {
  it('validiert Bild, Typ und Größe', () => {
    assert.deepEqual(parseOcrRequest(IMAGE), IMAGE)
    for (const bad of [
      null,
      { ...IMAGE, image: 'kurz' },
      { ...IMAGE, image: 'A'.repeat(199) + '!' },
      { ...IMAGE, mediaType: 'image/gif' },
      { ...IMAGE, width: 0 },
      { ...IMAGE, height: 4001 },
      { ...IMAGE, width: 10.5 },
    ]) {
      assert.throws(() => parseOcrRequest(bad), ValidationError)
    }
  })

  it('schickt das Bild mit Größenangabe und JSON-Schema', () => {
    const p = buildOcrParams(parseOcrRequest(IMAGE), { model: 'm', effort: 'medium' })
    const content = p.messages[0]?.content as { type: string; source?: unknown; text?: string }[]
    assert.deepEqual(content[0]?.source, {
      type: 'base64',
      media_type: 'image/jpeg',
      data: IMAGE.image,
    })
    assert.match(content[1]?.text ?? '', /1000 × 1400 Pixel/)
    assert.equal(p.output_config?.format?.type, 'json_schema')
  })

  it('begrenzt Rechtecke aufs Bild und verwirft unbrauchbare Zeilen', () => {
    const req = parseOcrRequest(IMAGE)
    const out = sanitizeOcr(
      {
        lines: [
          { text: '  Max   Mustermann ', x0: 120, y0: 80, x1: -5, y1: 100 },
          { text: 'Rand', x0: 900, y0: 1390, x1: 1200, y1: 1500 },
          { text: '', x0: 0, y0: 0, x1: 10, y1: 10 },
          { text: 'Punkt', x0: 5, y0: 5, x1: 5, y1: 20 },
          { text: 'kaputt', x0: 'a', y0: 0, x1: 1, y1: 1 },
          'Unsinn',
        ],
      },
      req,
    )
    assert.deepEqual(out, [
      { text: 'Max Mustermann', box: [0, 80, 120, 100] },
      { text: 'Rand', box: [900, 1390, 1000, 1400] },
    ])
    assert.deepEqual(sanitizeOcr({}, req), [])
  })

  it('liefert erkannte Zeilen', async () => {
    const lines = await recognizePage(
      fakeStream(message(JSON.stringify({ lines: [{ text: 'A', x0: 1, y0: 2, x1: 30, y1: 12 }] }))),
      parseOcrRequest(IMAGE),
      { model: 'm', effort: 'medium', signal: new AbortController().signal },
    )
    assert.deepEqual(lines, [{ text: 'A', box: [1, 2, 30, 12] }])
  })
})

const FORM = {
  profile: 'Max Mustermann, geb. 01.02.1980, Hauptstr. 5, 10115 Berlin',
  fields: [
    { id: 'f1', type: 'text', label: 'name', context: 'Name, Vorname', page: 1, maxLength: 10 },
    { id: 'f2', type: 'checkbox', label: 'verheiratet', context: '', page: 1 },
    {
      id: 'f3',
      type: 'choice',
      label: 'land',
      context: 'Land',
      page: 1,
      options: ['Deutschland', 'Österreich'],
    },
    { id: 'f4', type: 'text', label: 'bem', context: '', page: 1, multiline: true },
  ],
}

describe('form-suggestions', () => {
  it('validiert Felder und verlangt Stammdaten oder Formulartext', () => {
    const r = parseFormRequest(FORM, 10_000)
    assert.equal(r.fields.length, 4)
    assert.deepEqual(r.pages, [])
    for (const bad of [
      { ...FORM, fields: [] },
      { ...FORM, fields: [{ ...FORM.fields[0], type: 'signature' }] },
      { ...FORM, fields: [FORM.fields[0], FORM.fields[0]] },
      { ...FORM, fields: [{ ...FORM.fields[2], options: [] }] },
      { ...FORM, fields: [{ ...FORM.fields[0], page: 0 }] },
      { ...FORM, profile: 'x'.repeat(20_001) },
      { ...FORM, profile: '  ' },
    ]) {
      assert.throws(() => parseFormRequest(bad, 10_000), ValidationError)
    }
    assert.equal(
      parseFormRequest({ ...FORM, profile: '', pages: REQ.pages }, 10_000).pages.length,
      2,
    )
  })

  it('schickt Stammdaten, Felder und Formulartext', () => {
    const p = buildFormParams(parseFormRequest({ ...FORM, pages: REQ.pages }, 10_000), {
      model: 'm',
      effort: 'medium',
    })
    const content = String(p.messages[0]?.content)
    assert.match(content, /<stammdaten>\nMax Mustermann/)
    assert.match(content, /"text_daneben": "Name, Vorname"/)
    assert.match(content, /<page number="1">/)
    assert.equal(p.output_config?.format?.type, 'json_schema')
  })

  it('prüft Vorschläge je Feldtyp', () => {
    const req = parseFormRequest(FORM, 10_000)
    const out = sanitizeSuggestions(
      {
        suggestions: [
          { id: 'f1', value: 'Mustermann, Max', reason: 'Stammdaten' },
          { id: 'f1', value: 'doppelt', reason: '' },
          { id: 'f2', value: 'Ja', reason: '' },
          { id: 'f3', value: 'deutschland', reason: '' },
          { id: 'f4', value: 'a\nb', reason: '' },
          { id: 'f9', value: 'unbekannt', reason: '' },
          { id: 'f3', value: 'Schweiz', reason: '' },
        ],
      },
      req,
    )
    assert.deepEqual(
      out.map((s) => [s.id, s.value]),
      [
        ['f1', 'Mustermann'],
        ['f2', 'true'],
        ['f3', 'Deutschland'],
        ['f4', 'a\nb'],
      ],
    )
    const reqNoMulti = { ...req, fields: req.fields.map((f) => ({ ...f, multiline: false })) }
    assert.equal(
      sanitizeSuggestions(
        { suggestions: [{ id: 'f4', value: 'a\n b', reason: '' }] },
        reqNoMulti,
      )[0]?.value,
      'a b',
    )
    assert.deepEqual(
      sanitizeSuggestions({ suggestions: [{ id: 'f2', value: 'vielleicht', reason: '' }] }, req),
      [],
    )
  })

  it('liefert Vorschläge', async () => {
    const out = await suggestFormValues(
      fakeStream(
        message(JSON.stringify({ suggestions: [{ id: 'f3', value: 'Österreich', reason: 'r' }] })),
      ),
      parseFormRequest(FORM, 10_000),
      { model: 'm', effort: 'medium', signal: new AbortController().signal },
    )
    assert.deepEqual(out, [{ id: 'f3', value: 'Österreich', reason: 'r' }])
  })
})

describe('toHttpError', () => {
  it('bildet SDK-Fehler auf Status ab', () => {
    assert.equal(
      toHttpError(new Anthropic.RateLimitError(429, undefined, 'x', new Headers()), false).status,
      429,
    )
    assert.equal(toHttpError(new Anthropic.APIConnectionError({ message: 'x' }), false).status, 502)
    assert.equal(
      toHttpError(new Anthropic.AuthenticationError(401, undefined, 'x', new Headers()), false)
        .status,
      500,
    )
    assert.equal(toHttpError(new Error('x'), true).status, 504)
    assert.equal(toHttpError(new Error('x'), false).status, 500)
  })
})

describe('HTTP', () => {
  let server: Server
  let base: string
  let next: BetaMessage | Error = message('{"findings":[]}')
  let lastParams: { model?: string } = {}
  const logs: string[] = []
  const META0 = {
    model: 'claude-opus-5-5',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }

  before(async () => {
    const handler = createHandler({
      config: {
        model: 'claude-opus-5-5',
        models: ['claude-opus-5-5', 'claude-haiku-5-5'],
        effort: 'medium',
        maxBodyBytes: 20_000,
        maxChars: 10_000,
        maxAskChars: 10_000,
        timeoutMs: 5_000,
      },
      stream: (params, options) => {
        lastParams = params as { model?: string }
        return fakeStream(next)(params, options)
      },
      log: (l) => logs.push(l),
    })
    server = createServer((req, res) => void handler(req, res))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  after(() => new Promise<void>((r) => server.close(() => r())))

  const post = (body: string, type = 'application/json') =>
    fetch(`${base}/api/redaction-suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': type },
      body,
    })

  it('GET /api/health', async () => {
    const res = await fetch(`${base}/api/health`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), {
      ok: true,
      model: 'claude-opus-5-5',
      models: ['claude-opus-5-5', 'claude-haiku-5-5'],
    })
  })

  it('liefert Vorschläge und loggt keinen Dokumentinhalt', async () => {
    next = message(
      JSON.stringify({
        findings: [{ page: 1, text: 'Max Mustermann', category: 'name', reason: 'Name' }],
      }),
    )
    const res = await post(JSON.stringify(REQ))
    assert.equal(res.status, 200)
    const body = (await res.json()) as { findings: { text: string }[] }
    assert.equal(body.findings[0]?.text, 'Max Mustermann')
    assert.ok(logs.some((l) => l.startsWith('suggest ok')))
    assert.ok(!logs.join('\n').includes('Mustermann'))
  })

  it('validiert Methode, Content-Type, Größe und Inhalt', async () => {
    assert.equal((await fetch(`${base}/api/redaction-suggestions`)).status, 405)
    assert.equal((await post(JSON.stringify(REQ), 'text/plain')).status, 415)
    assert.equal((await post('x'.repeat(30_000))).status, 413)
    assert.equal((await post('{kaputt')).status, 400)
    const res = await post(JSON.stringify({ pages: [] }))
    assert.equal(res.status, 400)
    assert.match(((await res.json()) as { error: string }).error, /Keine Seiten/)
    assert.equal((await fetch(`${base}/api/anderes`)).status, 404)
  })

  it('beantwortet Fragen über /api/ask', async () => {
    next = message('Erika Musterfrau (S. 2)')
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ASK),
    })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { answer: 'Erika Musterfrau (S. 2)', meta: META0 })
    assert.ok(logs.some((l) => l.startsWith('ask ok') && l.includes('turns=3')))
    assert.ok(!logs.join('\n').includes('Absender'))
    assert.equal((await fetch(`${base}/api/ask`)).status, 405)
  })

  it('schreibt Text über /api/rewrite um, ohne ihn zu loggen', async () => {
    next = message(JSON.stringify({ text: 'Sehr geehrte Damen und Herren', meta: META0 }))
    const res = await fetch(`${base}/api/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hallo Leute', mode: 'formal' }),
    })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { text: 'Sehr geehrte Damen und Herren', meta: META0 })
    assert.ok(logs.some((l) => l.startsWith('rewrite ok mode=formal chars=11')))
    assert.ok(!logs.join('\n').includes('Leute'))
  })

  it('erkennt Scans über /api/ocr, ohne Text oder Bild zu loggen', async () => {
    next = message(JSON.stringify({ lines: [{ text: 'Geheim', x0: 1, y0: 1, x1: 50, y1: 10 }] }))
    const res = await fetch(`${base}/api/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(IMAGE),
    })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), {
      lines: [{ text: 'Geheim', box: [1, 1, 50, 10] }],
      meta: META0,
    })
    assert.ok(logs.some((l) => l.startsWith('ocr ok size=1000x1400') && l.includes('lines=1')))
    assert.ok(!logs.join('\n').includes('Geheim'))
    assert.ok(!logs.join('\n').includes('AAAA'))
  })

  it('schlägt Formularwerte über /api/form-suggestions vor, ohne Stammdaten zu loggen', async () => {
    next = message(JSON.stringify({ suggestions: [{ id: 'f1', value: 'Max', reason: 'r' }] }))
    const res = await fetch(`${base}/api/form-suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(FORM),
    })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), {
      suggestions: [{ id: 'f1', value: 'Max', reason: 'r' }],
      meta: META0,
    })
    assert.ok(logs.some((l) => l.startsWith('form ok fields=4')))
    assert.ok(!logs.join('\n').includes('Hauptstr'))
  })

  it('nutzt das gewählte Modell und meldet Modell und Tokens zurück', async () => {
    const reply = message(JSON.stringify({ text: 'Hallo' }))
    next = {
      ...reply,
      model: 'claude-haiku-5-5',
      usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 5 },
    } as unknown as BetaMessage
    const res = await fetch(`${base}/api/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hallo', mode: 'correct', model: 'claude-haiku-5-5' }),
    })
    assert.equal(res.status, 200)
    assert.equal(lastParams.model, 'claude-haiku-5-5')
    assert.deepEqual(((await res.json()) as { meta: unknown }).meta, {
      model: 'claude-haiku-5-5',
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: 5,
      cacheWriteTokens: 0,
    })
    assert.ok(logs.some((l) => l.includes('model=claude-haiku-5-5 in=120 out=30')))
  })

  it('lehnt Modelle außerhalb der Allowlist ab, ohne Claude aufzurufen', async () => {
    lastParams = {}
    for (const model of ['claude-fable-5-2', 42, '']) {
      const res = await fetch(`${base}/api/rewrite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hallo', mode: 'correct', model }),
      })
      assert.equal(res.status, 400)
      assert.match(((await res.json()) as { error: string }).error, /"model"/)
    }
    assert.equal(lastParams.model, undefined)
  })

  it('erzeugt ein Dokument über /api/generate-document, ohne die Beschreibung zu loggen', async () => {
    next = message(
      JSON.stringify({
        title: 'Vorlage',
        blocks: [
          { type: 'heading', level: 1, text: 'Anmeldung' },
          { type: 'field', text: 'Name' },
        ],
      }),
    )
    const res = await fetch(`${base}/api/generate-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Anmeldeformular Sportverein Geheimclub',
        format: 'A5',
        orientation: 'landscape',
        language: 'de',
      }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { document: { title: string; blocks: unknown[] } }
    assert.equal(body.document.title, 'Vorlage')
    assert.equal(body.document.blocks.length, 2)
    assert.ok(
      logs.some((l) => l.startsWith('generate ok format=A5:landscape') && l.includes('blocks=2')),
    )
    assert.ok(!logs.join('\n').includes('Geheimclub'))
  })

  it('reicht KI-Fehler als verständliche Meldung durch', async () => {
    next = new Anthropic.RateLimitError(429, undefined, 'rate limited', new Headers())
    const res = await post(JSON.stringify(REQ))
    assert.equal(res.status, 429)
    assert.match(((await res.json()) as { error: string }).error, /ausgelastet/)
  })
})
