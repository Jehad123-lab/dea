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
#define USE_BATCHING
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

                /* BATCHING */
                attribute float batchId;
                uniform sampler2D batchingTexture;
                mat4 getBatchingMatrix(const in float i) {
                    int size = textureSize(batchingTexture, 0).x;
                    int j = int(i) * 4;
                    int x = j % size;
                    int y = j / size;
                    vec4 v1 = texelFetch(batchingTexture, ivec2(x, y), 0);
                    vec4 v2 = texelFetch(batchingTexture, ivec2(x + 1, y), 0);
                    vec4 v3 = texelFetch(batchingTexture, ivec2(x + 2, y), 0);
                    vec4 v4 = texelFetch(batchingTexture, ivec2(x + 3, y), 0);
                    return mat4(v1, v2, v3, v4);
                }

                uniform sampler2D tOptions;
                vec4 getOptions(const in float i) {
                    int size = textureSize(tOptions, 0).x;
                    int x = int(i) % size;
                    int y = int(i) / size;
                    return texelFetch(tOptions, ivec2(x, y), 0);
                }

                // attribute vec3 rand;
                attribute float emission;

                varying vec2 vUv;
                varying vec3 vPos;
                varying float vDisplacement;
                varying float vBounce;
                varying float vEmission;

                vec2 rotate(vec2 v, float a) {
                    float s = sin(a);
                    float c = cos(a);
                    mat2 m = mat2(c, s, -s, c);
                    return m * v;
                }

                void main() {
                    vUv = uv;
                    vEmission = emission;

                    mat4 batchingMatrix = getBatchingMatrix(batchId);
                    vec3 pos = (getBatchingMatrix(batchId) * vec4(position, 1.0)).xyz;
                    vPos = pos;

                    vec4 options = getOptions(batchId);
                    vDisplacement = options.r;
                    vBounce = options.g;

                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }
            