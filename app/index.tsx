import { CameraView, CameraType, useCameraPermissions } from "expo-camera";
import { useRef, useState, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Pressable,
  Dimensions,
} from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withTiming,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";

const { width, height } = Dimensions.get("window");

// Wrap CameraView so Reanimated can drive its props on the UI thread
const AnimatedCameraView = Reanimated.createAnimatedComponent(CameraView);

export let capturedPhotos: string[] = [];
export const resetPhotos = () => {
  capturedPhotos = [];
};

export default function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing] = useState<CameraType>("back");
  const [photoCount, setPhotoCount] = useState(0);
  const cameraRef = useRef<CameraView>(null);

  const zoom = useSharedValue(0);
  const savedZoom = useSharedValue(0);

  const shutterScale = useSharedValue(1);
  const flashOpacity = useSharedValue(0);
  const counterScale = useSharedValue(1);

  const takePicture = useCallback(async () => {
    if (!cameraRef.current) return;

    flashOpacity.value = withTiming(1, { duration: 60 }, () => {
      flashOpacity.value = withTiming(0, { duration: 120 });
    });
    shutterScale.value = withSpring(0.88, { damping: 12 }, () => {
      shutterScale.value = withSpring(1, { damping: 10 });
    });

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,
        exif: false,
      });

      if (photo?.uri) {
        capturedPhotos = [...capturedPhotos, photo.uri];
        const newCount = capturedPhotos.length;
        counterScale.value = withSpring(1.4, { damping: 8 }, () => {
          counterScale.value = withSpring(1, { damping: 10 });
        });
        runOnJS(setPhotoCount)(newCount);
      }
    } catch (e) {
      console.error("Photo capture failed:", e);
    }
  }, []);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      const delta = (e.scale - 1) * 0.3;
      const newZoom = Math.min(1, Math.max(0, savedZoom.value + delta));
      zoom.value = newZoom;
    })
    .onEnd(() => {
      savedZoom.value = zoom.value;
    });

  // Drive zoom on the UI thread via animated props — avoids reading .value during render
  const animatedCameraProps = useAnimatedProps(() => ({
    zoom: zoom.value,
  }));

  const shutterStyle = useAnimatedStyle(() => ({
    transform: [{ scale: shutterScale.value }],
  }));
  const flashStyle = useAnimatedStyle(() => ({
    opacity: flashOpacity.value,
  }));
  const counterBadgeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: counterScale.value }],
  }));

  const goToGallery = () => {
    if (capturedPhotos.length > 0) router.push("/gallery");
  };

  const clearBatch = () => {
    capturedPhotos = [];
    setPhotoCount(0);
  };

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionTitle}>Camera Access</Text>
        <Text style={styles.permissionSubtitle}>
          BatchCam needs camera access to capture photos
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={requestPermission}
        >
          <Text style={styles.permissionButtonText}>Grant Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <GestureDetector gesture={pinchGesture}>
        <Reanimated.View style={{ flex: 1 }}>
          <AnimatedCameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
            animatedProps={animatedCameraProps}
          />
        </Reanimated.View>
      </GestureDetector>

      <Reanimated.View
        style={[styles.flashOverlay, flashStyle]}
        pointerEvents="none"
      />

      <View style={styles.topBar}>
        <View style={styles.topLeft}>
          <Text style={styles.appName}>BATCH</Text>
          <Text style={styles.appNameAccent}>CAM</Text>
        </View>
        {photoCount > 0 && (
          <TouchableOpacity style={styles.clearButton} onPress={clearBatch}>
            <Text style={styles.clearButtonText}>CLEAR</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.zoomIndicatorContainer} pointerEvents="none">
        <Text style={styles.zoomHint}>Pinch to zoom</Text>
      </View>

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[
            styles.galleryButton,
            photoCount === 0 && styles.galleryButtonDisabled,
          ]}
          onPress={goToGallery}
          disabled={photoCount === 0}
        >
          {photoCount > 0 ? (
            <Reanimated.View style={[styles.counterBadge, counterBadgeStyle]}>
              <Text style={styles.counterNumber}>{photoCount}</Text>
              <Text style={styles.counterLabel}>SHOTS</Text>
            </Reanimated.View>
          ) : (
            <View style={styles.emptyGallery}>
              <Text style={styles.emptyGalleryText}>—</Text>
            </View>
          )}
        </TouchableOpacity>

        <Reanimated.View style={[styles.shutterOuter, shutterStyle]}>
          <Pressable style={styles.shutterInner} onPress={takePicture}>
            <View style={styles.shutterCore} />
          </Pressable>
        </Reanimated.View>

        <TouchableOpacity
          style={[
            styles.viewBatchButton,
            photoCount === 0 && styles.viewBatchDisabled,
          ]}
          onPress={goToGallery}
          disabled={photoCount === 0}
        >
          <Text
            style={[
              styles.viewBatchText,
              photoCount === 0 && styles.viewBatchTextDisabled,
            ]}
          >
            VIEW{"\n"}BATCH
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  permissionContainer: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  permissionTitle: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: 2,
    marginBottom: 12,
  },
  permissionSubtitle: {
    color: "#888",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 40,
  },
  permissionButton: {
    backgroundColor: "#fff",
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 4,
  },
  permissionButtonText: {
    color: "#000",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 2,
  },
  flashOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#fff",
    zIndex: 10,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 60,
    paddingHorizontal: 24,
    paddingBottom: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    zIndex: 5,
  },
  topLeft: { flexDirection: "row", alignItems: "baseline" },
  appName: { color: "#fff", fontSize: 18, fontWeight: "800", letterSpacing: 4 },
  appNameAccent: {
    color: "#f0c040",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 4,
  },
  clearButton: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.4)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  clearButtonText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
  },
  zoomIndicatorContainer: {
    position: "absolute",
    bottom: 160,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 5,
  },
  zoomHint: { color: "rgba(255,255,255,0.35)", fontSize: 11, letterSpacing: 1 },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 140,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 32,
    paddingBottom: 32,
    zIndex: 5,
  },
  galleryButton: {
    width: 64,
    height: 64,
    justifyContent: "center",
    alignItems: "center",
  },
  galleryButtonDisabled: { opacity: 0.3 },
  counterBadge: {
    width: 60,
    height: 60,
    backgroundColor: "#f0c040",
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  counterNumber: {
    color: "#000",
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 24,
  },
  counterLabel: {
    color: "#000",
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  emptyGallery: {
    width: 60,
    height: 60,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  emptyGalleryText: { color: "rgba(255,255,255,0.3)", fontSize: 20 },
  shutterOuter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
  },
  shutterInner: {
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: "center",
    alignItems: "center",
  },
  shutterCore: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "#fff",
  },
  viewBatchButton: {
    width: 64,
    height: 64,
    justifyContent: "center",
    alignItems: "center",
  },
  viewBatchDisabled: { opacity: 0.25 },
  viewBatchText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    textAlign: "center",
    lineHeight: 15,
  },
  viewBatchTextDisabled: { color: "rgba(255,255,255,0.5)" },
});
