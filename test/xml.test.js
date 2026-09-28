import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser, XMLBuilder } from '../src/xml.js';

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  suppressEmptyNode: true,
  format: true,
  indentBy: '  ',
  newlineAfterEndTag: true,
});

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  trimValues: true,
});

describe('xml.js — internal engine', () => {
  test('builds a document with attributes, nesting, and repeated tags', () => {
    const xml = builder.build({
      AML: {
        '@version': '10.2',
        'Header-Info': { '@Name': 'x' },
        Group: {
          '@ID': 'g',
          ObjDef: [
            { '@ID': 'a', AttrDef: [{ '@Type': 'AT_NAME', '#text': 'Val' }] },
            { '@ID': 'b' },
          ],
        },
      },
    });
    assert.match(xml, /<AML version="10\.2">/);
    assert.match(xml, /<Header-Info Name="x"\/>/);
    assert.match(xml, /<ObjDef ID="a">/);
    assert.match(xml, /<AttrDef Type="AT_NAME">Val<\/AttrDef>/);
    assert.match(xml, /<ObjDef ID="b"\/>/);
    assert.match(xml, /<\/Group>/);
    assert.match(xml, /<\/AML>/);
  });

  test('escapes attribute and text values on build', () => {
    const xml = builder.build({ R: { '@A': 'x & < y "z"' } });
    assert.match(xml, /x &amp; &lt; y &quot;z&quot;/);
  });

  test('parses attributes, repeated tags, and text', () => {
    const xml = [
      '<AML version="10.2">',
      '  <Group id="g">',
      '    <ObjDef id="a"><AttrDef t="AT_NAME">A &amp; B</AttrDef></ObjDef>',
      '    <ObjDef id="b"/>',
      '  </Group>',
      '</AML>',
    ].join('\n');
    const o = parser.parse(xml);
    assert.equal(o.AML['@version'], '10.2');
    assert.equal(o.AML.Group['@id'], 'g');
    assert.ok(Array.isArray(o.AML.Group.ObjDef), 'ObjDef is an array');
    assert.equal(o.AML.Group.ObjDef.length, 2);
    assert.equal(o.AML.Group.ObjDef[0]['@id'], 'a');
    const ads = o.AML.Group.ObjDef[0].AttrDef;
    const ad = Array.isArray(ads) ? ads[0] : ads;
    assert.equal(ad['@t'], 'AT_NAME');
    assert.equal(ad['#text'], 'A & B', 'entity unescaping in text');
  });

  test('build → parse round-trip preserves structure and text', () => {
    const doc = {
      R: {
        '@id': 'root',
        Item: [
          { '@id': '1', 'Value': 'one & two', N: 3 },
          { '@id': '2', 'Value': 'three', N: 17 },
        ],
      },
    };
    const xml = new XMLBuilder({ attributeNamePrefix: '@' }).build(doc);
    const back = new XMLParser({ attributeNamePrefix: '@' }).parse(xml);
    assert.equal(back.R['@id'], 'root');
    const items = back.R.Item;
    assert.ok(Array.isArray(items) && items.length === 2);
    assert.equal(items[0].Value['#text'], 'one & two');
    assert.equal(items[1].N['#text'], '17');
  });

  test('handles boolean / self-closing elements', () => {
    const o = parser.parse('<doc><empty/ x="1"><flag y="on"/></doc>');
    assert.ok(o.doc, 'doc root parsed');
  });
});
