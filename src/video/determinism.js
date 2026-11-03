// Makes every render reproducible: wall-clock APIs follow the frame being rendered,
// and Math.random is seeded, so the same scene always produces the same video.
(() => {
  const EPOCH = 1700000000000;
  let nowMs = 0;
  performance.now = () => nowMs;
  Date.now = () => EPOCH + nowMs;

  window.__determinism = {
    setTime(seconds) {
      nowMs = seconds * 1000;
    },
    seed(value) {
      let a = value >>> 0;
      // mulberry32
      Math.random = () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
  };
})();
