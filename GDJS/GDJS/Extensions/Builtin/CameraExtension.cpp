/*
 * GDevelop JS Platform
 * Copyright 2008-2016 Florian Rival (Florian.Rival@gmail.com). All rights
 * reserved. This project is released under the MIT License.
 */
#include "CameraExtension.h"

#include "GDCore/CommonTools.h"
#include "GDCore/Extensions/Builtin/AllBuiltinExtensions.h"
#include "GDCore/Tools/Localization.h"

namespace gdjs {

CameraExtension::CameraExtension() {
  gd::BuiltinExtensionsImplementer::ImplementsCameraExtension(*this);

  GetAllActions()["CameraX"]  // Deprecated
      .SetFunctionName("gdjs.evtTools.camera.setCameraX")
      .SetGetter("gdjs.evtTools.camera.getCameraX");
  GetAllActions()["CameraY"]  // Deprecated
      .SetFunctionName("gdjs.evtTools.camera.setCameraY")
      .SetGetter("gdjs.evtTools.camera.getCameraY");
  GetAllActions()["SetCameraX"]  // Deprecated
      .SetFunctionName("gdjs.evtTools.camera.setCameraX")
      .SetGetter("gdjs.evtTools.camera.getCameraX");
  GetAllActions()["SetCameraY"]  // Deprecated
      .SetFunctionName("gdjs.evtTools.camera.setCameraY")
      .SetGetter("gdjs.evtTools.camera.getCameraY");
  GetAllActions()["SetCameraCenterX"]
      .SetFunctionName("gdjs.evtTools.camera.setCameraX")
      .SetGetter("gdjs.evtTools.camera.getCameraX");
  GetAllActions()["SetCameraCenterY"]
      .SetFunctionName("gdjs.evtTools.camera.setCameraY")
      .SetGetter("gdjs.evtTools.camera.getCameraY");

  GetAllConditions()["CameraX"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraX");  // Deprecated
  GetAllConditions()["CameraY"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraY");  // Deprecated
  GetAllConditions()["CameraCenterX"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraX");
  GetAllConditions()["CameraCenterY"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraY");
  GetAllConditions()["CameraWidth"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraWidth");
  GetAllConditions()["CameraHeight"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraHeight");
  GetAllConditions()["CameraBorderLeft"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraBorderLeft");
  GetAllConditions()["CameraBorderRight"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraBorderRight");
  GetAllConditions()["CameraBorderTop"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraBorderTop");
  GetAllConditions()["CameraBorderBottom"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraBorderBottom");
  GetAllActions()["ShowLayer"].SetFunctionName(
      "gdjs.evtTools.camera.showLayer");
  GetAllActions()["HideLayer"].SetFunctionName(
      "gdjs.evtTools.camera.hideLayer");
  GetAllConditions()["LayerVisible"].SetFunctionName(
      "gdjs.evtTools.camera.layerIsVisible");
  GetAllConditions()["CameraAngle"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraRotation");
  GetAllActions()["SetCameraAngle"]
      .SetFunctionName("gdjs.evtTools.camera.setCameraRotation")
      .SetGetter("gdjs.evtTools.camera.getCameraRotation");
  GetAllActions()["RotateCamera"]  // Deprecated
      .SetFunctionName("gdjs.evtTools.camera.setCameraRotation")
      .SetGetter("gdjs.evtTools.camera.getCameraRotation");
  GetAllActions()["ZoomCamera"].SetFunctionName(
      "gdjs.evtTools.camera.setCameraZoom");
  GetAllConditions()["CameraZoom"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraZoom");

  GetAllExpressions()["CameraX"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraX");  // Deprecated
  GetAllExpressions()["VueX"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraX");  // Deprecated
  GetAllExpressions()["CameraY"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraY");  // Deprecated
  GetAllExpressions()["VueY"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraY");  // Deprecated
  GetAllExpressions()["CameraCenterY"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraY");
  GetAllExpressions()["CameraCenterX"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraX");
  GetAllExpressions()["CameraBorderLeft"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraBorderLeft");
  GetAllExpressions()["CameraBorderRight"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraBorderRight");
  GetAllExpressions()["CameraBorderTop"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraBorderTop");
  GetAllExpressions()["CameraBorderBottom"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraBorderBottom");
  GetAllExpressions()["CameraAngle"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraRotation");
  GetAllExpressions()["CameraRotation"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraRotation");
  GetAllExpressions()["VueRotation"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraRotation");
  GetAllExpressions()["CameraZoom"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraZoom");
  GetAllExpressions()["CameraWidth"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraWidth");
  GetAllExpressions()["CameraHeight"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraHeight");

  GetAllActions()["FixCamera"].SetFunctionName(
      "gdjs.evtTools.camera.centerCameraWithinLimits");  // Deprecated
  GetAllActions()["ClampCamera"].SetFunctionName(
      "gdjs.evtTools.camera.clampCamera");
  GetAllActions()["CenterCameraOnObject"].SetFunctionName(
      "gdjs.evtTools.camera.centerCamera");
  // Compatibility with GD <= 5.6.251
  GetAllActions()["CentreCamera"].SetFunctionName(
      "gdjs.evtTools.camera.centerCamera");
  // End of compatibility code

  GetAllActions()["SetLayerEffectParameter"].SetFunctionName(
      "gdjs.evtTools.camera.setLayerEffectDoubleParameter");
  GetAllActions()["SetLayerEffectStringParameter"].SetFunctionName(
      "gdjs.evtTools.camera.setLayerEffectStringParameter");
  GetAllActions()["SetLayerEffectBooleanParameter"].SetFunctionName(
      "gdjs.evtTools.camera.setLayerEffectBooleanParameter");
  GetAllActions()["EnableLayerEffect"].SetFunctionName(
      "gdjs.evtTools.camera.enableLayerEffect");
  GetAllConditions()["LayerEffectEnabled"].SetFunctionName(
      "gdjs.evtTools.camera.layerEffectEnabled");

  GetAllConditions()["LayerTimeScale"].SetFunctionName(
      "gdjs.evtTools.camera.getLayerTimeScale");
  GetAllActions()["ChangeLayerTimeScale"].SetFunctionName(
      "gdjs.evtTools.camera.setLayerTimeScale");
  GetAllExpressions()["LayerTimeScale"].SetFunctionName(
      "gdjs.evtTools.camera.getLayerTimeScale");

  GetAllConditions()["LayerDefaultZOrder"].SetFunctionName(
      "gdjs.evtTools.camera.getLayerDefaultZOrder");
  GetAllActions()["SetLayerDefaultZOrder"].SetFunctionName(
      "gdjs.evtTools.camera.setLayerDefaultZOrder");
  GetAllExpressions()["LayerDefaultZOrder"].SetFunctionName(
      "gdjs.evtTools.camera.getLayerDefaultZOrder");

  GetAllActions()["SetLayerAmbientLightColor"].SetFunctionName(
      "gdjs.evtTools.camera.setLayerAmbientLightColor");

  GetAllActions()["AddCamera"].SetFunctionName(
      "gdjs.evtTools.camera.addCamera");
  GetAllActions()["DeleteCamera"].SetFunctionName(
      "gdjs.evtTools.camera.deleteCamera");
  GetAllActions()["CameraSize"].SetFunctionName(
      "gdjs.evtTools.camera.setCameraSize");
  GetAllActions()["CameraViewport"].SetFunctionName(
      "gdjs.evtTools.camera.setCameraViewport");
  GetAllExpressions()["CameraViewportLeft"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraViewportLeft");
  GetAllExpressions()["CameraViewportTop"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraViewportTop");
  GetAllExpressions()["CameraViewportRight"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraViewportRight");
  GetAllExpressions()["CameraViewportBottom"].SetFunctionName(
      "gdjs.evtTools.camera.getCameraViewportBottom");

}

}  // namespace gdjs
