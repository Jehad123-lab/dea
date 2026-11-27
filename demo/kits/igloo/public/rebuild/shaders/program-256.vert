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
                #ifndef PI
#define PI 3.141592653589793
#endif
#ifndef HALF_PI
#define HALF_PI 1.5707963267948966
#endif
float backIn(float t){return pow(t,3.)-t*sin(t*PI);}float backOut(float t){return 1.0-backIn(1.0-t);}float backInOut(float t){float f=t<0.5? 2.0*t: 1.0-(2.0*t-1.0);float g=backIn(f);return t<0.5? 0.5*g: 0.5*(1.0-g)+0.5;}float bounceOut(float t){const float a=4.0/11.0;const float b=8.0/11.0;const float c=9.0/10.0;const float ca=4356.0/361.0;const float cb=35442.0/1805.0;const float cc=16061.0/1805.0;float t2=t*t;return t<a? 7.5625*t2: t<b? 9.075*t2-9.9*t+3.4: t<c? ca*t2-cb*t+cc: 10.8*t*t-20.52*t+10.72;}float bounceIn(float t){return 1.0-bounceOut(1.0-t);}float bounceInOut(float t){return t<0.5? 0.5*(1.0-bounceOut(1.0-t*2.0)): 0.5*bounceOut(t*2.0-1.0)+0.5;}float circularIn(float t){return 1.0-sqrt(1.0-t*t);}float circularOut(float t){return sqrt((2.0-t)*t);}float circularInOut(float t){return t<0.5? 0.5*(1.0-sqrt(1.0-4.0*t*t)): 0.5*(sqrt((3.0-2.0*t)*(2.0*t-1.0))+1.0);}float cubicIn(float t){return t*t*t;}float cubicOut(float t){float f=t-1.0;return f*f*f+1.0;}float cubicInOut(float t){return t<0.5? 4.0*t*t*t: 0.5*-pow(2.0-2.0*t,3.0)+1.0;}float elasticIn(float t){return sin(13.0*t*HALF_PI)*pow(2.0,10.0*(t-1.0));}float elasticOut(float t){return sin(-13.0*(t+1.0)*HALF_PI)*pow(2.0,-10.0*t)+1.0;}float elasticInOut(float t){return t<0.5? 0.5*sin(+13.0*HALF_PI*2.0*t)*pow(2.0,10.0*(2.0*t-1.0)): 0.5*sin(-13.0*HALF_PI*((2.0*t-1.0)+1.0))*pow(2.0,-10.0*(2.0*t-1.0))+1.0;}float expoIn(float t){return t==0.0 ? t : pow(2.0,10.0*(t-1.0));}float expoOut(float t){return t==1.0 ? t : 1.0-pow(2.0,-10.0*t);}float expoInOut(float t){return t==0.0||t==1.0? t: t<0.5?+0.5*pow(2.0,(20.0*t)-10.0):-0.5*pow(2.0,10.0-(t*20.0))+1.0;}float linear(float t){return t;}float quadraticIn(float t){return t*t;}float quadraticOut(float t){return-t*(t-2.0);}float quadraticInOut(float t){float p=2.0*t*t;return t<0.5 ? p :-p+(4.0*t)-1.0;}float quarticIn(float t){return pow(t,4.0);}float quarticOut(float t){return pow(1.0-t,3.0)*(t-1.0)+1.0;}float quarticInOut(float t){return t<0.5?+8.0*pow(t,4.0):-8.0*pow(1.0-t,4.0)+1.0;}float quinticIn(float t){return pow(t,5.0);}float quinticOut(float t){return 1.0-pow(1.0-t,5.0);}float quinticInOut(float t){return t<0.5?+16.0*pow(t,5.0):-0.5*pow(2.0-2.0*t,5.0)+1.0;}float sineIn(float t){return sin((t-1.0)*HALF_PI)+1.0;}float sineOut(float t){return sin(t*HALF_PI);}float sineInOut(float t){return-0.5*(cos(PI*t)-1.0);}
#define power0(t) linear(t)
#define power1In(t) quadraticIn(t)
#define power1Out(t) quadraticOut(t)
#define power1InOut(t) quadraticInOut(t)
#define power2In(t) cubicIn(t)
#define power2Out(t) cubicOut(t)
#define power2InOut(t) cubicInOut(t)
#define power3In(t) quarticIn(t)
#define power3Out(t) quarticOut(t)
#define power3InOut(t) quarticInOut(t)
#define power4In(t) quinticIn(t)
#define power4Out(t) quinticOut(t)
#define power4InOut(t) quinticInOut(t)


                attribute float progress;
                uniform float uSize;

                flat varying float vProgress;

                void main() {
                    vProgress = progress;
                    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
                    float size = uSize * progress;

                    gl_Position = projectionMatrix * viewPos;
                    gl_PointSize = size / length(viewPos.xyz) * (resolution.y / 1300.0);
                }
            