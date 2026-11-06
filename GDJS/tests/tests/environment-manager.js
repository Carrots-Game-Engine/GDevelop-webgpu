// @ts-check
describe('gdjs.EnvironmentManager helpers', () => {
  const textToBuffer = (text) => new TextEncoder().encode(text).buffer;

  describe('getEnvironmentFileExtension', () => {
    it('returns the lowercased extension', () => {
      expect(gdjs.getEnvironmentFileExtension('sky.HDR')).to.be.equal('hdr');
      expect(gdjs.getEnvironmentFileExtension('room.exr')).to.be.equal('exr');
    });

    it('ignores the query string and hash', () => {
      expect(gdjs.getEnvironmentFileExtension('room.hdr?t=1')).to.be.equal(
        'hdr'
      );
      expect(gdjs.getEnvironmentFileExtension('room.exr#frag')).to.be.equal(
        'exr'
      );
    });

    it('returns an empty string without an extension', () => {
      expect(gdjs.getEnvironmentFileExtension('room')).to.be.equal('');
      expect(gdjs.getEnvironmentFileExtension('')).to.be.equal('');
    });
  });

  describe('normalizeEnvironmentQuality', () => {
    it('keeps the known qualities', () => {
      expect(gdjs.normalizeEnvironmentQuality('low')).to.be.equal('low');
      expect(gdjs.normalizeEnvironmentQuality('medium')).to.be.equal('medium');
      expect(gdjs.normalizeEnvironmentQuality('high')).to.be.equal('high');
      expect(gdjs.normalizeEnvironmentQuality('auto')).to.be.equal('auto');
    });

    it('falls back to auto for unknown or missing values', () => {
      expect(gdjs.normalizeEnvironmentQuality(undefined)).to.be.equal('auto');
      expect(gdjs.normalizeEnvironmentQuality(null)).to.be.equal('auto');
      expect(gdjs.normalizeEnvironmentQuality('')).to.be.equal('auto');
      expect(gdjs.normalizeEnvironmentQuality('ultra')).to.be.equal('auto');
    });
  });

  describe('getEnvironmentQualityMaxCubeSize', () => {
    it('returns the maximum size of each tier', () => {
      expect(gdjs.getEnvironmentQualityMaxCubeSize('low')).to.be.equal(128);
      expect(gdjs.getEnvironmentQualityMaxCubeSize('medium')).to.be.equal(256);
      expect(gdjs.getEnvironmentQualityMaxCubeSize('high')).to.be.equal(512);
      expect(gdjs.getEnvironmentQualityMaxCubeSize('auto')).to.be.equal(1024);
    });
  });

  describe('getEnvironmentQualityCubeSize', () => {
    it('caps the native size to the tier maximum', () => {
      expect(gdjs.getEnvironmentQualityCubeSize('low', 4096)).to.be.equal(128);
      expect(gdjs.getEnvironmentQualityCubeSize('medium', 4096)).to.be.equal(
        256
      );
      expect(gdjs.getEnvironmentQualityCubeSize('high', 4096)).to.be.equal(512);
      expect(gdjs.getEnvironmentQualityCubeSize('auto', 4096)).to.be.equal(
        1024
      );
    });

    it('never upscales the source', () => {
      expect(gdjs.getEnvironmentQualityCubeSize('high', 64)).to.be.equal(64);
      expect(gdjs.getEnvironmentQualityCubeSize('auto', 200)).to.be.equal(200);
    });

    it('never returns less than 16 pixels', () => {
      expect(gdjs.getEnvironmentQualityCubeSize('low', 5)).to.be.equal(16);
      expect(gdjs.getEnvironmentQualityCubeSize('high', 0)).to.be.equal(16);
      expect(gdjs.getEnvironmentQualityCubeSize('auto', NaN)).to.be.equal(16);
    });
  });

  describe('isUltraHDRBuffer', () => {
    it('returns false for a plain JPEG', () => {
      expect(
        gdjs.isUltraHDRBuffer(textToBuffer('\xff\xd8\xff\xe0JFIF'))
      ).to.be.equal(false);
    });

    it('returns false when the MPF marker has no gain map metadata', () => {
      expect(
        gdjs.isUltraHDRBuffer(textToBuffer('\xff\xd8MPF\x00some exif'))
      ).to.be.equal(false);
    });

    it('returns true when the MPF marker and gain map metadata are present', () => {
      expect(
        gdjs.isUltraHDRBuffer(textToBuffer('\xff\xd8MPF\x00xmp:hdrgm'))
      ).to.be.equal(true);
      expect(
        gdjs.isUltraHDRBuffer(textToBuffer('\xff\xd8MPF\x00GContainer'))
      ).to.be.equal(true);
    });
  });

  describe('getEnvironmentCacheKey', () => {
    /**
     * @param {gdjs.EnvironmentSourceType} type
     * @param {string} resourceName
     * @returns {gdjs.EnvironmentSource}
     */
    const equirectSource = (type, resourceName) => ({ type, resourceName });

    it('is stable for the same source and quality', () => {
      const source = equirectSource('equirect', 'sky.hdr');
      expect(gdjs.getEnvironmentCacheKey(source, 'auto')).to.be.equal(
        gdjs.getEnvironmentCacheKey(source, 'auto')
      );
    });

    it('depends on the quality', () => {
      const source = equirectSource('equirect', 'sky.hdr');
      expect(gdjs.getEnvironmentCacheKey(source, 'low')).not.to.be.equal(
        gdjs.getEnvironmentCacheKey(source, 'high')
      );
    });

    it('depends on the resource names', () => {
      const first = equirectSource('equirect', 'sky.hdr');
      const second = equirectSource('equirect', 'other.hdr');
      expect(gdjs.getEnvironmentCacheKey(first, 'auto')).not.to.be.equal(
        gdjs.getEnvironmentCacheKey(second, 'auto')
      );
    });

    it('depends on the cube faces and their order', () => {
      const faces = ['a', 'b', 'c', 'd', 'e', 'f'];
      /** @type {gdjs.EnvironmentSource} */
      const first = { type: 'cube', faceResourceNames: faces };
      /** @type {gdjs.EnvironmentSource} */
      const reversed = {
        type: 'cube',
        faceResourceNames: faces.slice().reverse(),
      };
      expect(gdjs.getEnvironmentCacheKey(first, 'auto')).not.to.be.equal(
        gdjs.getEnvironmentCacheKey(reversed, 'auto')
      );
    });

    it('depends on the skybox texture', () => {
      /** @type {gdjs.EnvironmentSource} */
      const first = {
        type: 'skybox',
        texture: /** @type {any} */ ({ uuid: 'uuid-1' }),
      };
      /** @type {gdjs.EnvironmentSource} */
      const second = {
        type: 'skybox',
        texture: /** @type {any} */ ({ uuid: 'uuid-2' }),
      };
      expect(gdjs.getEnvironmentCacheKey(first, 'auto')).not.to.be.equal(
        gdjs.getEnvironmentCacheKey(second, 'auto')
      );
    });
  });
});
