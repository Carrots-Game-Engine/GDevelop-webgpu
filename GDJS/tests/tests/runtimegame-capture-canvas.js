describe('gdjs.RuntimeGamePixiRenderer (capture canvas)', () => {
  const makeCanvas = (width, height, color) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
    return canvas;
  };

  it('returns the existing canvas when WebGPU is not active', () => {
    const gameCanvas = makeCanvas(2, 2, 'rgb(10, 20, 30)');
    const renderer = Object.create(gdjs.RuntimeGamePixiRenderer.prototype);
    renderer._gameCanvas = gameCanvas;
    renderer._threeCanvas = null;

    expect(renderer.getCanvasForCapture()).to.be(gameCanvas);
  });

  it('composites WebGPU below the transparent Pixi canvas', () => {
    const webGPUCanvas = makeCanvas(1, 1, 'rgb(255, 0, 0)');
    const pixiCanvas = makeCanvas(1, 1, 'rgba(0, 0, 255, 0.5)');
    const renderer = Object.create(gdjs.RuntimeGamePixiRenderer.prototype);
    renderer._gameCanvas = pixiCanvas;
    renderer._threeCanvas = webGPUCanvas;

    const captureCanvas = renderer.getCanvasForCapture();
    const pixel = captureCanvas.getContext('2d').getImageData(0, 0, 1, 1).data;

    expect(Math.abs(pixel[0] - 128) < 2).to.be(true);
    expect(pixel[1]).to.be(0);
    expect(Math.abs(pixel[2] - 127) < 2).to.be(true);
    expect(pixel[3]).to.be(255);
  });
});
