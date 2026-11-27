// ShaderMaterial with uSize, tNums, uColor: a shader program from the site, rebuilt by DEA.
// Verified: the GLSL below is exactly what the site compiled (three.js chunks already expanded), so it runs as a
// RawShaderMaterial with no changes. Inferred: uniform starting values marked "guess" and the geometry.
import * as THREE from 'three';

export const vertexShader = /* glsl */ `#version 300 es

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


                //- edit
                uniform Global{vec2 resolution;vec2 resolutionUI;float aspect;float time;float dtRatio;};
                vec3 getMatrixTranslation(mat4 mat){return vec3(mat[3]);}void setMatrixTranslation(inout mat4 mat,vec3 translation){mat[3].xyz=translation;}vec3 getMatrixScale(mat4 mat){vec3 scale=vec3(length(mat[0].xyz),length(mat[1].xyz),length(mat[2].xyz));return determinant(mat)<0.0 ? vec3(-scale.x,scale.yz): scale;}void setMatrixScale(inout mat4 mat,vec3 scale){vec3 invScale=1.0/getMatrixScale(mat);mat[0]*=invScale.x*scale.x;mat[1]*=invScale.y*scale.y;mat[2]*=invScale.z*scale.z;}mat4 getMatrixRotation(mat4 mat){mat4 m=mat4(1.0);vec3 scale=getMatrixScale(mat);m[0]=mat[0]/scale.x;m[1]=mat[1]/scale.y;m[2]=mat[2]/scale.z;return m;}void setMatrixRotation(inout mat4 mat,vec3 rotation){vec3 scale=getMatrixScale(mat);float x=rotation.x,y=rotation.y,z=rotation.z;float a=cos(x),b=sin(x);float c=cos(y),d=sin(y);float e=cos(z),f=sin(z);float ae=a*e,af=a*f,be=b*e,bf=b*f;mat[0].xyz=vec3(c*e,-c*f,d)*scale.x;mat[1].xyz=vec3(af+be*d,ae-bf*d,-b*c)*scale.y;mat[2].xyz=vec3(bf-ae*d,be+af*d,a*c)*scale.z;}void matrixCompose(inout mat4 mat,vec3 translation,vec4 quaternion,vec3 scale){float x=quaternion.x;float y=quaternion.y;float z=quaternion.z;float w=quaternion.w;float x2=x+x;float y2=y+y;float z2=z+z;float xx=x*x2;float xy=x*y2;float xz=x*z2;float yy=y*y2;float yz=y*z2;float zz=z*z2;float wx=w*x2;float wy=w*y2;float wz=w*z2;float sx=scale.x;float sy=scale.y;float sz=scale.z;mat[0]=vec4((1.0-(yy+zz))*sx,(xy+wz)*sx,(xz-wy)*sx,0.0);mat[1]=vec4((xy-wz)*sy,(1.0-(xx+zz))*sy,(yz+wx)*sy,0.0);mat[2]=vec4((xz+wy)*sz,(yz-wx)*sz,(1.0-(xx+yy))*sz,0.0);mat[3]=vec4(translation.xyz,1.0);}vec3 getViewRight(){return vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);}vec3 getViewLeft(){return-getViewRight();}vec3 getViewUp(){return vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);}vec3 getViewDown(){return-getViewUp();}vec3 getViewBack(){return vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2]);}vec3 getViewForward(){return-getViewBack();}mat4 billBoardMatrix(mat4 mat){mat4 m=mat4(1.0);vec3 scale=getMatrixScale(mat);m[0].xyz=getViewRight()*scale.x;m[1].xyz=getViewUp()*scale.y;m[2].xyz=getViewBack()*scale.z;m[3].xyz=getMatrixTranslation(mat);return m;}mat4 billboardModelMatrix(vec3 offset){mat4 m=billBoardMatrix(modelMatrix);setMatrixTranslation(m,offset);return m;}mat4 billboardModelMatrix(){return billBoardMatrix(modelMatrix);}
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
                attribute ivec2 nums;
                attribute int side;
                flat varying ivec2 vNums;
                flat varying float vProgress;
                flat varying int vSide;

                uniform float uSize;
                varying vec2 vUv;

                void main() {
                    vUv = uv;
                    vSide = side;
                    vProgress = progress;
                    vNums = nums;

                    vec3 left = getViewLeft();
                    vec3 up = getViewUp();

                    float size = uSize;
                    vec4 pos = instanceMatrix * billboardModelMatrix() * vec4(position * size * power1In(progress), 1.0);

                    // detect side
                    vec4 projPos = projectionMatrix * viewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                    float screenSide = -sign(projPos.x / projPos.w);

                    pos.xyz += left * screenSide * uSize * 1.75;
                    pos.xyz += up * 1.0 * uSize;

                    gl_Position = projectionMatrix * viewMatrix * pos;
                }
            `;

export const fragmentShader = /* glsl */ `#version 300 es
#define varying in
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
#define gl_FragDepthEXT gl_FragDepth
#define texture2D texture
#define textureCube texture
#define texture2DProj textureProj
#define texture2DLodEXT textureLod
#define texture2DProjLodEXT textureProjLod
#define textureCubeLodEXT textureLod
#define texture2DGradEXT textureGrad
#define texture2DProjGradEXT textureProjGrad
#define textureCubeGradEXT textureGrad
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
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;

const mat3 LINEAR_SRGB_TO_LINEAR_DISPLAY_P3 = mat3(
	vec3( 0.8224621, 0.177538, 0.0 ),
	vec3( 0.0331941, 0.9668058, 0.0 ),
	vec3( 0.0170827, 0.0723974, 0.9105199 )
);
const mat3 LINEAR_DISPLAY_P3_TO_LINEAR_SRGB = mat3(
	vec3( 1.2249401, - 0.2249404, 0.0 ),
	vec3( - 0.0420569, 1.0420571, 0.0 ),
	vec3( - 0.0196376, - 0.0786361, 1.0982735 )
);
vec4 LinearSRGBToLinearDisplayP3( in vec4 value ) {
	return vec4( value.rgb * LINEAR_SRGB_TO_LINEAR_DISPLAY_P3, value.a );
}
vec4 LinearDisplayP3ToLinearSRGB( in vec4 value ) {
	return vec4( value.rgb * LINEAR_DISPLAY_P3_TO_LINEAR_SRGB, value.a );
}
vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}
vec4 LinearToLinear( in vec4 value ) {
	return value;
}
vec4 LinearTosRGB( in vec4 value ) {
	return sRGBTransferOETF( value );
}
vec4 linearToOutputTexel( vec4 value ) { return ( LinearTransferOETF( value ) ); }


                //- edit
                uniform Global{vec2 resolution;vec2 resolutionUI;float aspect;float time;float dtRatio;};
                float median(sampler2D tMap,vec2 uv){vec3 tex=texture2D(tMap,uv).rgb;return max(min(tex.r,tex.g),min(max(tex.r,tex.g),tex.b))-0.5;}float msdf(sampler2D tMap,vec2 uv){float signedDist=median(tMap,uv);float d=fwidth(signedDist);return smoothstep(-d,d,signedDist);}float msdfOpaque(sampler2D tMap,vec2 uv){return step(0.0,median(tMap,uv));}float msdf(sampler2D tMap,vec2 uv,float outlineWidth){float signedDist=median(tMap,uv);float d=max(10e-6,fwidth(signedDist));return smoothstep(-d-outlineWidth,d-outlineWidth,signedDist)*smoothstep(outlineWidth+d,outlineWidth-d,signedDist);}float msdfOpaque(sampler2D tMap,vec2 uv,float outlineWidth){float signedDist=median(tMap,uv);return step(-outlineWidth,signedDist)*step(signedDist,outlineWidth);}

                flat varying float vProgress;
                flat varying int vSide;
                flat varying ivec2 vNums;

                uniform sampler2D tNums;
                uniform vec3 uColor;
                varying vec2 vUv;

                void main() {

                    float numStep = 1.0 / 10.0;
                    float num = float(vSide < 0 ? vNums.x : vNums.y);

                    vec2 uv = vec2(numStep * vUv.x + num * numStep, vUv.y);
                    float a = msdf(tNums, uv);

                    gl_FragColor = vec4(uColor, a);
                }
            `;

/** Textures this program samples, with the wrap and filter the site used. */
export const textures = {
  tNums: { file: '/textures/5-t33.png', wrap: 'ClampToEdgeWrapping', minFilter: 'LinearFilter', magFilter: 'LinearFilter' }, // placeholder: your own image
};

export function createMaterial(overrides = {}) {
  const loader = new THREE.TextureLoader();
  const tex = (t) => {
    const x = loader.load(t.file);
    x.wrapS = x.wrapT = THREE[t.wrap];
    x.minFilter = THREE[t.minFilter];
    x.magFilter = THREE[t.magFilter];
    return x;
  };
  return new THREE.RawShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    uniforms: {
      morphTexture: { value: null }, // no texture was bound when DEA watched
      uSize: { value: 1 }, // float: not seen: a guess
      tNums: { value: tex(textures.tNums) }, // placeholder 280×36: put your own image here
      uColor: { value: new THREE.Vector3(0, 0, 0) }, // vec3: not seen: a guess
      ...overrides,
    },
  });
}

/** What moves each uniform on the site. Apply every frame with update(material, state). */
export const drivers = {

};

/** state: { time (s), scrollY (px), pointer: { x, y } (px), width, height } */
export function update(material, state) {
  for (const [k, d] of Object.entries(drivers)) {
    const u = material.uniforms[k];
    if (!u) continue;
    if (d.kind === 'viewport' && d.of === 'size' && u.value && u.value.isVector2) {
      u.value.set(state.width, state.height);
      continue;
    }
    const v =
      d.kind === 'clock'
        ? state.time * d.perSecond
        : d.kind === 'scroll'
          ? d.scale * state.scrollY + d.offset
          : d.kind === 'pointer'
            ? d.scale * (d.axis === 'x' ? state.pointer.x : state.pointer.y) + d.offset
            : d.kind === 'viewport'
              ? d.of === 'width' ? state.width : d.of === 'height' ? state.height : state.width / state.height
              : null;
    if (v == null) continue;
    if (typeof u.value === 'number') u.value = v;
    else if (u.value && 'x' in u.value) u.value.x = v;
  }
}

export const meta = { name: 'SizeNumsColorShader', fullscreen: false, points: false };
