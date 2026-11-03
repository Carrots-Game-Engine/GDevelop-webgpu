# نتائج البحث: THREE.WebGLRenderer / threeRenderer / _threeRenderer / getThreeRenderer

تاريخ البحث: 2026-11-03 (محدَّث بعد migration)
نطاق البحث: `GDJS/**/*.ts` + `Extensions/**/*.ts` + `Extensions/**/*.js`

---

## حالة الـ Migration

| الخطوة | الحالة |
|---|---|
| `ThreeRendererAdapterOptions` — interface | ✅ |
| `IThreeBackend` — interface | ✅ |
| `WebGLBackend` — أول implementation | ✅ |
| `ThreeRendererAdapter` — facade | ✅ |
| `gdjs.getThreeBackend(game)` — top-level helper | ✅ |
| `ProjectPropertiesData.threeBackend` — حقل في الـ data type | ✅ |
| `RuntimeGame._threeBackend` + `getThreeBackend()` | ✅ |
| `runtimegame-pixi-renderer`: `_threeRenderer` → `_threeAdapter` | ✅ |
| `runtimegame-pixi-renderer`: `new THREE.WebGLRenderer(...)` → `adapter.init()` | ✅ |
| `runtimegame-pixi-renderer`: resize → `adapter.resize()` | ✅ |
| `runtimegame-pixi-renderer`: dispose → `adapter.dispose()` | ✅ |
| `runtimegame-pixi-renderer`: `getThreeRenderer()` → delegate لـ adapter | ✅ |
| `runtimegame-pixi-renderer`: `getThreeAdapter()` — getter جديد | ✅ |

---

## ملخص سريع (بعد المigration)

| المصطلح | عدد الملفات | الملفات |
|---|---|---|
| `THREE.WebGLRenderer` (استخدام مباشر) | 3 | runtimescene-pixi-renderer.ts, layer-pixi-renderer.ts, ThreeRendererAdapter.ts |
| `_threeRenderer` | 1 | runtimescene-pixi-renderer.ts (local ref من game renderer) |
| `threeRenderer` (local var) | 4 | runtimescene-pixi-renderer.ts, layer-pixi-renderer.ts, runtimescene.ts, gameplay-test-runner.ts |
| `getThreeRenderer()` | 7 | runtimegame-pixi-renderer.ts (delegate), runtimescene-pixi-renderer.ts, layer-pixi-renderer.ts, runtimescene.ts, abstract-debugger-client.ts, gameplay-test-runner.ts, ThreeRendererAdapter.ts |
| `_threeAdapter` | 1 | runtimegame-pixi-renderer.ts (المالك الجديد) |
| `getThreeBackend()` | 2 | runtimegame.ts, ThreeRendererAdapter.ts |
| Extensions | 1 | Extensions/3D/tests/DirectionalLight.spec.js |

---

## 1. GDJS/Runtime/pixi-renderers/ThreeRendererAdapter.ts *(الملف الجديد)*

### Interfaces / Types

| الاسم | النوع | الوصف |
|---|---|---|
| `gdjs.ThreeRendererAdapterOptions` | interface | Options تُمرَّر لـ `IThreeBackend.init()` |
| `gdjs.IThreeBackend` | interface | العقد الذي يجب أن يُنفَّذه كل backend |
| `gdjs.WebGLBackend` | class | أول backend — يغلّف `THREE.WebGLRenderer` |
| `gdjs.ThreeRendererAdapter` | class | الـ facade العامة التي يستخدمها باقي المحرك |
| `gdjs.getThreeBackend(game)` | function | يقرأ `threeBackend` من بيانات اللعبة |

### `WebGLBackend` — الـ implementation الكاملة

```typescript
class WebGLBackend implements IThreeBackend {
  // init()      ← new THREE.WebGLRenderer({ canvas, stencil, antialias, preserveDrawingBuffer, powerPreference })
  //               + shadowMap.enabled/type + autoClear=false + setSize()
  // render()    ← threeRenderer.render(scene, camera)
  // resize()    ← threeRenderer.setSize(w, h)
  // resetState()← threeRenderer.resetState()
  // dispose()   ← threeRenderer.dispose() + null
  // getThreeRenderer() / getContext() / isInitialized()
}
```

### `ThreeRendererAdapter` — الـ facade

```typescript
class ThreeRendererAdapter {
  constructor(backendType: 'webgl' | 'webgpu')
  static createBackend(backendType): IThreeBackend   // factory
  init / render / resize / resetState / dispose      // delegates لـ backend
  getThreeRenderer() / getContext() / isInitialized() / getBackendType()
}
```

---

## 2. GDJS/Runtime/pixi-renderers/runtimegame-pixi-renderer.ts *(معدَّل)*

**التغييرات:**

| قبل | بعد |
|---|---|
| `private _threeRenderer: THREE.WebGLRenderer \| null` | `private _threeAdapter: gdjs.ThreeRendererAdapter \| null` |
| `new THREE.WebGLRenderer({ ... })` في `initializeRenderers()` | `new gdjs.ThreeRendererAdapter(gdjs.getThreeBackend(game))` + `adapter.init({...})` |
| `this._threeRenderer.getContext()` | `this._threeAdapter.getContext()` |
| `this._threeRenderer.setSize(w,h)` في `_resizeCanvas()` | `this._threeAdapter.resize(w,h)` |
| `this._threeRenderer?.dispose()` في `dispose()` | `this._threeAdapter?.dispose()` |
| `getThreeRenderer(): THREE.WebGLRenderer \| null` | delegate: `this._threeAdapter?.getThreeRenderer() ?? null` |
| — | `getThreeAdapter(): ThreeRendererAdapter \| null` *(جديد)* |

**ملاحظة:** `getThreeRenderer()` لا تزال تعيد `THREE.WebGLRenderer | null` — لا يوجد breaking change لأي caller خارجي.

---

## 3. GDJS/Runtime/runtimegame.ts *(معدَّل)*

| الإضافة | الموقع |
|---|---|
| `_threeBackend: 'webgl' \| 'webgpu'` field | سطر ~220 |
| `this._threeBackend = this._data.properties.threeBackend \|\| 'webgl'` في constructor | سطر ~358 |
| `getThreeBackend(): 'webgl' \| 'webgpu'` getter | بعد `isAntialisingEnabledOnMobile()` |

---

## 4. GDJS/Runtime/types/project-data.d.ts *(معدَّل)*

```typescript
declare interface ProjectPropertiesData {
  // ... الحقول الموجودة ...
  threeBackend?: 'webgl' | 'webgpu';  // ← جديد، optional للتوافق مع مشاريع قديمة
}
```

---

## 5. ملفات لم تتغير (تستخدم getThreeRenderer() مباشرة — لا تحتاج تغيير)

| الملف | السبب |
|---|---|
| `runtimescene-pixi-renderer.ts` | يستخدم `runtimeGameRenderer.getThreeRenderer()` — لا يزال يعمل |
| `layer-pixi-renderer.ts` | يستقبل `THREE.WebGLRenderer` كـ parameter — لا يتغير |
| `runtimescene.ts` | `game.getRenderer().getThreeRenderer()` — لا يتغير |
| `abstract-debugger-client.ts` | `!!gameRenderer.getThreeRenderer()` — لا يتغير |
| `gameplay-test-runner.ts` | `gameRenderer.getThreeRenderer()` — لا يتغير |
| `Extensions/3D/tests/DirectionalLight.spec.js` | `getRenderer().getThreeRenderer()` — لا يتغير |

---

## كيف تضيف Backend جديد (مثل WebGPU)

1. أنشئ `class WebGPUBackend implements gdjs.IThreeBackend` في ملف جديد
2. أضف `case 'webgpu': return new gdjs.WebGPUBackend();` في `ThreeRendererAdapter.createBackend()`
3. احذف الـ fallback warning

لا تغيير في أي ملف آخر.
