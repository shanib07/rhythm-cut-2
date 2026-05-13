export async function register() {
  if (typeof global !== 'undefined' && global.localStorage) {
    try {
      delete (global as any).localStorage;
    } catch (e) {
      console.error('Failed to delete global.localStorage', e);
    }
  }
}
