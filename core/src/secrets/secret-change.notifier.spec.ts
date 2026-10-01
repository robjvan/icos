import { SecretChangeNotifier } from './secret-change.notifier';

describe('SecretChangeNotifier', () => {
  it('notifies subscribed listeners and honors unsubscribe', () => {
    const notifier = new SecretChangeNotifier();
    const seen: string[] = [];
    const off = notifier.onChange((reference) => seen.push(reference));

    notifier.notify('secret:a');
    off();
    notifier.notify('secret:b');
    expect(seen).toEqual(['secret:a']);
  });

  it('never lets a throwing listener break the subject', () => {
    const notifier = new SecretChangeNotifier();
    const seen: string[] = [];
    notifier.onChange(() => {
      throw new Error('listener bug');
    });
    notifier.onChange((reference) => seen.push(reference));

    expect(() => notifier.notify('secret:a')).not.toThrow();
    expect(seen).toEqual(['secret:a']);
  });
});
