import { describe, expect, it } from 'vitest'

import { isLikelyProseCodeBlock, isLikelyProseFence, isLikelyStructuredText } from './markdown-code'

describe('isLikelyProseCodeBlock', () => {
  it('detects prose that Streamdown mislabels as an unknown language', () => {
    expect(
      isLikelyProseCodeBlock(
        'heads',
        [
          '- Pure white (`#ffffff`), roughness 0.55, no emissive',
          '- Black wireframe edges at 35% opacity',
          '',
          'Want the bunny gone, or want me to keep riffing on it?'
        ].join('\n')
      )
    ).toBe(true)
  })

  it('keeps real code blocks', () => {
    expect(isLikelyProseCodeBlock('ts', 'const value = { bunny: true };\nreturn value')).toBe(false)
  })

  it('keeps a ```tsv data block fenced (Getchu 12-col rows, ASCII-title regression)', () => {
    const rows = [
      'Relirium 光我做主！\t奈々瀬 ひな\tNanase Hina\t\t18\t4/2\tA\t150\t45\t78\t56\t80',
      'Relirium 光我做主！\t星野 みはる\tHoshino Miharu\t\t22\t7/7\tO\t161\t52\t92\t60\t92'
    ].join('\n')

    expect(isLikelyProseCodeBlock('tsv', rows)).toBe(false)
  })

  it('keeps an unlabeled TSV block fenced (tab rows are structured data)', () => {
    const rows = [
      '完堕ちX兄嫁 -アンタのせいよ！\t佐伯 千歳\tSaeki Chitose\t\t26\t\tA\t158\t48\t85\t58\t86',
      '完堕ちX兄嫁 -アンタのせいよ！\t神谷 詩織\tKamiya Shiori\t高1\t\t5/5\tO\t152\t44\t76\t54\t78'
    ].join('\n')

    expect(isLikelyProseCodeBlock('', rows)).toBe(false)
  })

  it('still unwraps English prose that an ASCII/numeric line would once have fenced', () => {
    expect(
      isLikelyProseCodeBlock(
        '',
        [
          '200 players joined the event yesterday.',
          'Everyone seems to agree the bunny must go.',
          'The next round starts very soon after this.'
        ].join('\n')
      )
    ).toBe(true)
  })

  it('keeps an SSH config block fenced (regression: rendered as flat prose)', () => {
    const ssh = ['Host 192.168.0.159', '    HostName 192.168.0.159', '    User teknium', '    Port 22'].join('\n')

    expect(isLikelyProseCodeBlock('', ssh)).toBe(false)
    expect(isLikelyProseCodeBlock('text', ssh)).toBe(false)
  })

  it('keeps a flat key-value config fenced', () => {
    expect(isLikelyProseCodeBlock('', ['Host myserver', 'User teknium', 'Port 22'].join('\n'))).toBe(false)
  })

  it('keeps an .env-style dump fenced', () => {
    expect(isLikelyProseCodeBlock('', ['API_KEY=abc123', 'PORT=8080', 'DEBUG=true'].join('\n'))).toBe(false)
  })
})

describe('isLikelyStructuredText', () => {
  it('flags indented config stanzas', () => {
    expect(isLikelyStructuredText(['Host x', '    HostName 10.0.0.1', '    Port 22'].join('\n'))).toBe(true)
  })

  it('flags flat key-value / settings listings', () => {
    expect(isLikelyStructuredText(['Host myserver', 'User teknium', 'Port 22'].join('\n'))).toBe(true)
    expect(isLikelyStructuredText(['API_KEY=abc123', 'PORT=8080', 'DEBUG=true'].join('\n'))).toBe(true)
  })

  it('does NOT flag real wrapped prose', () => {
    expect(
      isLikelyStructuredText(
        [
          'This is the first sentence of a paragraph.',
          'Here is a second line that continues the thought.',
          'And a third concluding line follows here.'
        ].join('\n')
      )
    ).toBe(false)
  })

  it('does NOT flag prose without a config shape', () => {
    expect(
      isLikelyStructuredText(
        ['the quick brown fox jumps', 'over the lazy sleeping dog', 'while the sun sets slowly'].join('\n')
      )
    ).toBe(false)
  })

  it('ignores single-line blocks', () => {
    expect(isLikelyStructuredText('Port 22')).toBe(false)
  })
})

describe('isLikelyProseFence', () => {
  it('keeps an SSH config block fenced', () => {
    const ssh = ['Host 192.168.0.159', '    HostName 192.168.0.159', '    User teknium', '    Port 22'].join('\n')

    expect(isLikelyProseFence('', ssh)).toBe(false)
    expect(isLikelyProseFence('text', ssh)).toBe(false)
  })

  it('still unwraps a plain-language paragraph fence', () => {
    expect(
      isLikelyProseFence(
        '',
        [
          'This is the first sentence of a paragraph.',
          'Here is a second line that continues the thought.',
          'And a third concluding line follows here.'
        ].join('\n')
      )
    ).toBe(true)
  })
})
