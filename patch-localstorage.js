if (typeof global !== 'undefined' && global.localStorage) {
  try {
    delete global.localStorage;
  } catch (e) {
    console.error('Failed to delete global.localStorage', e);
  }
}
