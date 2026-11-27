#version 300 es

#define attribute in
#define varying out
#define texture2D texture
precision highp float;
	precision highp int;
	precision highp sampler2D;
	precision highp samplerCube;
	precision highp sampler3D;
	precision highp sampler2DArray;
	precision highp sampler2DShadow;
	precision highp samplerCubeShadow;
	precision highp sampler2DArrayShadow;
	precision highp isampler2D;
	precision highp isampler3D;
	precision highp isamplerCube;
	precision highp isampler2DArray;
	precision highp usampler2D;
	precision highp usampler3D;
	precision highp usamplerCube;
	precision highp usampler2DArray;
	
#define HIGH_PRECISION
#define SHADER_TYPE ShaderMaterial
#define SHADER_NAME 
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
#ifdef USE_INSTANCING
	attribute mat4 instanceMatrix;
#endif
#ifdef USE_INSTANCING_COLOR
	attribute vec3 instanceColor;
#endif
#ifdef USE_INSTANCING_MORPH
	uniform sampler2D morphTexture;
#endif
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
#ifdef USE_UV1
	attribute vec2 uv1;
#endif
#ifdef USE_UV2
	attribute vec2 uv2;
#endif
#ifdef USE_UV3
	attribute vec2 uv3;
#endif
#ifdef USE_TANGENT
	attribute vec4 tangent;
#endif
#if defined( USE_COLOR_ALPHA )
	attribute vec4 color;
#elif defined( USE_COLOR )
	attribute vec3 color;
#endif
#ifdef USE_SKINNING
	attribute vec4 skinIndex;
	attribute vec4 skinWeight;
#endif


                //- edit
                uniform Global{vec2 resolution;vec2 resolutionUI;float aspect;float time;float dtRatio;};

                varying vec2 vUv;
                varying vec3 vPos;
                varying vec3 vWorldPos;

                uniform float uProgress;
                uniform float uProgress2;
                uniform sampler2D tNoise;

                void main() {
                    vUv = uv;
                    vPos = position;
                    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;

                    vec3 pos = position;

                    // intro displacement
                    // float maxDist = 32.0;
                    // float noise = texture2D(tNoise, vWorldPos.xz * 0.07).r;
                    // float worldLen01 = clamp(length(vWorldPos.xz), 0.0, maxDist) / maxDist;
                    // worldLen01 += noise * 0.1;
                    // float wave2 = smoothstep(0.0 + uProgress, 0.5 + uProgress, worldLen01);
                    // wave2 = pow(wave2, 35.0);
                    // pos.y += wave2 * smoothstep(0.1, 0.15, worldLen01) * 0.5;

                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }
            