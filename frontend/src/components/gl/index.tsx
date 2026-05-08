import { Effects } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import { useRef } from "react";
import { Particles } from "./particles";
import { VignetteShader } from "./shaders/vignetteShader";
import * as easing from "maath/easing";

interface GLProps {
  hovering: boolean;
  speed?: number;
  darknessMultiplier?: number;
}

// Component to animate vignette darkness smoothly
function AnimatedVignette({ targetDarkness, offset }: { targetDarkness: number; offset: number }) {
  const shaderRef = useRef<{ uniforms: { darkness: { value: number } } } | null>(null);
  const darknessRef = useRef({ value: targetDarkness });

  useFrame((_, delta) => {
    if (!shaderRef.current) return;
    
    // Smooth transition over 0.5s
    easing.damp(darknessRef.current, "value", targetDarkness, 0.5, delta);
    shaderRef.current.uniforms.darkness.value = darknessRef.current.value;
  });

  return (
    <shaderPass
      ref={shaderRef}
      args={[VignetteShader]}
      uniforms-darkness-value={targetDarkness}
      uniforms-offset-value={offset}
    />
  );
}

export const GL = ({ hovering, speed: externalSpeed = 1.0, darknessMultiplier = 1.0 }: GLProps) => {
  // PERMANENT CHANGES:
  // To make changes permanent, update the 'value' fields below with your desired settings.
  // Example: speed: { value: 1.5, ... }
  const controls = useControls(
    "Particle System",
    {
      speed: { value: 0.4, min: 0, max: 2, step: 0.01 },
      noiseScale: { value: 0.6, min: 0.1, max: 5, step: 0.1 },
      noiseIntensity: { value: 0.52, min: 0, max: 2, step: 0.01 },
      timeScale: { value: 1, min: 0, max: 2, step: 0.01 },
      // focus: { value: 3.8, min: 0.1, max: 20, step: 0.1 },
      focus: { value: 3.6, min: 0.1, max: 20, step: 0.1 },
      aperture: { value: 1.79, min: 0, max: 2, step: 0.01 },
      pointSize: { value: 10.0, min: 0.1, max: 10, step: 0.1 },
      opacity: { value: 0.8, min: 0, max: 1, step: 0.01 },
      planeScale: { value: 10.0, min: 0.1, max: 10, step: 0.1 },
      size: {
        value: 512,
        options: [256, 512, 1024],
      },
      showDebugPlane: { value: false },
      vignetteDarkness: { value: 1.5, min: 0, max: 2, step: 0.1 },
      vignetteOffset: { value: 0.4, min: 0, max: 2, step: 0.1 },
      useManualTime: { value: false },
      manualTime: { value: 0, min: 0, max: 50, step: 0.01 },
    },
    {
      // Hide controls by default in production or based on a condition
      // hidden: process.env.NODE_ENV === "production",
      // render: () => process.env.NODE_ENV !== "production",
      render: () => false,
    }
  );

  const {
    speed,
    focus,
    aperture,
    size,
    noiseScale,
    noiseIntensity,
    timeScale,
    pointSize,
    opacity,
    planeScale,
    vignetteDarkness,
    vignetteOffset,
    useManualTime,
    manualTime,
  } = controls;

  // Apply external multipliers directly (leva caches initial values, so we multiply here)
  // darknessMultiplier > 1 means darker: reduce opacity and increase vignette
  const effectiveSpeed = speed * externalSpeed;
  const effectiveOpacity = opacity / darknessMultiplier; // e.g. 0.8 / 5 = 0.16 (80% darker)
  const effectiveVignetteDarkness = Math.min(vignetteDarkness * darknessMultiplier, 2.0);

  return (
    <div id="webgl">
      <Canvas
        camera={{
          position: [1.2629783123314589, 2.664606471394044, -1.8178993743288914],
          fov: 50,
          near: 0.01,
          far: 300,
        }}
      >
        {/* <Perf position="top-left" /> */}
        <color attach="background" args={["#000"]} />
        <Particles
          speed={effectiveSpeed}
          aperture={aperture}
          focus={focus}
          size={size}
          noiseScale={noiseScale}
          noiseIntensity={noiseIntensity}
          timeScale={timeScale}
          pointSize={pointSize}
          opacity={effectiveOpacity}
          planeScale={planeScale}
          useManualTime={useManualTime}
          manualTime={manualTime}
          introspect={hovering}
        />
        <Effects multisamping={0} disableGamma>
          <AnimatedVignette 
            targetDarkness={effectiveVignetteDarkness} 
            offset={vignetteOffset} 
          />
        </Effects>
      </Canvas>
    </div>
  );
};
