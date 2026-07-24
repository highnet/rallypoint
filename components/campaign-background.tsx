"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

type CampaignBackgroundProps = {
  focus?: number;
  variant?: "hero" | "agent";
};

const tokenColors = [0x8b62ae, 0xc84d37, 0x3d64ad, 0xd29a32, 0x3f8156, 0x63777b, 0xa8456f];

function tokenGeometry(index: number) {
  switch (index % 7) {
    case 0:
      return new THREE.CylinderGeometry(0.72, 0.72, 0.36, 6);
    case 1:
      return new THREE.ConeGeometry(0.78, 0.42, 3);
    case 2:
      return new THREE.BoxGeometry(1.15, 0.38, 1.15);
    case 3:
      return new THREE.CylinderGeometry(0.78, 0.78, 0.35, 5);
    case 4:
      return new THREE.DodecahedronGeometry(0.72, 0);
    case 5:
      return new THREE.CylinderGeometry(0.72, 0.72, 0.36, 20);
    default:
      return new THREE.OctahedronGeometry(0.82, 0);
  }
}

export function CampaignBackground({
  focus = 0,
  variant = "hero",
}: CampaignBackgroundProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(variant === "hero" ? 1.5 : 0, 9.5, 13);
    camera.lookAt(0, -0.4, 0);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const group = new THREE.Group();
    group.rotation.y = variant === "agent" ? -0.28 : 0.18;
    scene.add(group);

    const tabletop = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 18),
      new THREE.MeshStandardMaterial({ color: 0x173d2c, roughness: 0.94 }),
    );
    tabletop.rotation.x = -Math.PI / 2;
    tabletop.position.y = -1.22;
    tabletop.receiveShadow = true;
    group.add(tabletop);

    const route = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(-5.2, -0.96, -1.4),
        new THREE.Vector3(-2.8, -0.9, -3.2),
        new THREE.Vector3(0.8, -0.86, -2.9),
        new THREE.Vector3(4.5, -0.92, -0.7),
        new THREE.Vector3(2.2, -0.88, 2.8),
        new THREE.Vector3(-2.6, -0.92, 2.6),
        new THREE.Vector3(-5.2, -0.96, -1.4),
      ],
      true,
    );
    const routeMesh = new THREE.Mesh(
      new THREE.TubeGeometry(route, 96, 0.42, 8, true),
      new THREE.MeshStandardMaterial({
        color: 0xd8c18e,
        roughness: 0.88,
        metalness: 0.02,
      }),
    );
    routeMesh.receiveShadow = true;
    group.add(routeMesh);

    const positions = [
      [-4.6, -1.1],
      [-1.8, -3.1],
      [3.2, -2.2],
      [4.1, 1.5],
      [0.7, 3],
      [-3.7, 2],
      [0.9, -3.9],
    ];
    const tokens: THREE.Mesh[] = [];
    positions.forEach(([x, z], index) => {
      const token = new THREE.Mesh(
        tokenGeometry(index),
        new THREE.MeshStandardMaterial({
          color: tokenColors[index],
          roughness: 0.48,
          metalness: 0.08,
        }),
      );
      const emphasized = variant === "agent" && index === focus % positions.length;
      token.position.set(
        emphasized ? 0 : x,
        emphasized ? 0.2 : -0.52,
        emphasized ? 0 : z,
      );
      token.scale.setScalar(emphasized ? 2.25 : variant === "agent" ? 0.72 : 1);
      token.rotation.y = index * 0.47;
      token.castShadow = true;
      tokens.push(token);
      group.add(token);
    });

    const die = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.08, 0),
      new THREE.MeshStandardMaterial({
        color: 0xe4d29e,
        roughness: 0.5,
        metalness: 0.08,
      }),
    );
    die.position.set(variant === "agent" ? 3.9 : -0.3, 0.2, variant === "agent" ? -1.6 : 0);
    die.rotation.set(0.3, 0.5, 0.1);
    die.castShadow = true;
    group.add(die);

    const ambient = new THREE.HemisphereLight(0xf8e8bd, 0x10271f, 2.35);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffd98f, 5.2);
    key.position.set(-5, 11, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let pointerX = 0;
    let pointerY = 0;
    let frame = 0;

    const onPointerMove = (event: PointerEvent) => {
      pointerX = event.clientX / window.innerWidth - 0.5;
      pointerY = event.clientY / window.innerHeight - 0.5;
    };

    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    resize();

    const render = (time: number) => {
      if (!prefersReducedMotion.matches) {
        group.rotation.y += (0.18 + pointerX * 0.13 - group.rotation.y) * 0.025;
        group.rotation.x += (-pointerY * 0.045 - group.rotation.x) * 0.025;
        die.rotation.y = time * 0.00018;
        die.rotation.x = 0.3 + Math.sin(time * 0.0006) * 0.08;
        tokens.forEach((token, index) => {
          token.position.y +=
            (-0.52 + Math.sin(time * 0.0012 + index) * 0.035 - token.position.y) *
            0.08;
        });
      }
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(render);
    };
    if (prefersReducedMotion.matches) {
      renderer.render(scene, camera);
    } else {
      frame = window.requestAnimationFrame(render);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      observer.disconnect();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [focus, variant]);

  return <div className="campaign-background" aria-hidden="true" ref={hostRef} />;
}
