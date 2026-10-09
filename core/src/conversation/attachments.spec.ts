import { buildAttachmentBand } from './attachments';

describe('buildAttachmentBand', () => {
  it('returns null with no attachments (byte-identical context)', () => {
    expect(buildAttachmentBand()).toBeNull();
    expect(buildAttachmentBand([])).toBeNull();
    expect(buildAttachmentBand([{ url: '' }])).toBeNull();
  });

  it('describes name, type, size, and url', () => {
    const band = buildAttachmentBand([
      {
        url: 'https://x/y.png',
        name: 'y.png',
        contentType: 'image/png',
        sizeBytes: 42,
      },
    ]);
    expect(band).toContain('<attachments>');
    expect(band).toContain('name: y.png');
    expect(band).toContain('type: image/png');
    expect(band).toContain('size: 42');
    expect(band).toContain('url: https://x/y.png');
    expect(band).toContain('</attachments>');
  });

  it('caps at ten attachments and notes how many were omitted', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      url: `https://x/${i}`,
    }));
    const band = buildAttachmentBand(many);
    expect(band).toContain('url: https://x/9');
    expect(band).not.toContain('url: https://x/10');
    expect(band).toContain('(+2 more omitted)');
  });

  it('clips long fields and collapses whitespace', () => {
    const band = buildAttachmentBand([
      { url: `https://x/${'a'.repeat(300)}`, name: 'a\n b' },
    ]);
    expect(band).toContain('name: a b');
    expect(band).toContain('…');
  });
});
