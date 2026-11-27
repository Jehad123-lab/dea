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
#define USE_INSTANCING
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


                    uniform Global{vec2 resolution;vec2 resolutionUI;float aspect;float time;float dtRatio;};

                    uniform float uCount;

                    attribute vec4 rand;
                    attribute vec2 texuv;
                    uniform sampler2D tTexture1;
                    uniform sampler2D tTexture2;
                    uniform vec3 uMousePos;

                    varying vec2 vUv;
                    varying vec3 vNormal;
                    varying vec4 vRandom;
                    varying vec3 vPos;
                    varying vec4 vMvPos;
                    varying float vAlpha;
                    flat varying float vIndex;

                    mat2 rotateAngle(float a) {
                        float s = sin(a);
                        float c = cos(a);
                        mat2 m = mat2(c, s, -s, c);
                        return m;
                    }

                    const float PI = 3.14159;
                    const float HALF_PI = PI * 0.5;
                    const float TWO_PI = PI * 2.0;

                    void main() {
                        float index = float(gl_InstanceID);
                        vIndex = index;

                        vUv = uv;
                        vRandom = rand;

                        vec3 pos = position;
                        pos *= mix(0.85, 1.15, step(rand.x, 0.5));

                        // rotation value from fluid sim
                        // float interactionRotation = texture2D(tTexture2, texuv).a * 5.0;

                        // curl upwards
                        // mat2 rot = rotateAngle(0.25 * sin(uv.y * 3.5 + time + rand.z * 12.0 + rand.y + rand.x + interactionRotation * 3.0) + 0.2 * (1.0 - pow(1.0 - position.z, 2.0)));
                        // pos.yz = rot * pos.yz;

                        // random rotation angle
                        mat2 rot0 = rotateAngle(time * mix(0.75, 1.25, rand.z) + rand.z * 3.14 * 2.0);
                        mat2 rot1 = rotateAngle((rand.y + rand.z + rand.x) * 3.14 * 2.0);
                        mat2 rot2 = rotateAngle(rand.x * 3.14 * 2.0);
                        pos.xy = rot0 * pos.xy;
                        pos.zx = rot1 * pos.zx;
                        pos.yz = rot2 * pos.yz;

                        // vec3 norm = normal;
                        // norm.xy = rot0 * norm.xy;
                        // norm.zx = rot1 * norm.zx;
                        // norm.yz = rot2 * norm.yz;
                        // vNormal = normalize(normalMatrix * norm);

                        vec3 offset = texture2D(tTexture1, texuv).xyz;

                        pos += offset;

                        vPos = pos;
                        vMvPos = modelViewMatrix * vec4(pos, 1.0);

                        vAlpha = sin(time + pos.z * 0.25) * 0.5 + 0.5;

                        gl_Position = projectionMatrix * vMvPos;
                    }
                