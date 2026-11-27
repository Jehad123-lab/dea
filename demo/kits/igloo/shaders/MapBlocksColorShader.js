// ShaderMaterial with tMap, tBlocks, uColor, uColor2: a shader program from the site, rebuilt by DEA.
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


                vec3 getMatrixTranslation(mat4 mat){return vec3(mat[3]);}void setMatrixTranslation(inout mat4 mat,vec3 translation){mat[3].xyz=translation;}vec3 getMatrixScale(mat4 mat){vec3 scale=vec3(length(mat[0].xyz),length(mat[1].xyz),length(mat[2].xyz));return determinant(mat)<0.0 ? vec3(-scale.x,scale.yz): scale;}void setMatrixScale(inout mat4 mat,vec3 scale){vec3 invScale=1.0/getMatrixScale(mat);mat[0]*=invScale.x*scale.x;mat[1]*=invScale.y*scale.y;mat[2]*=invScale.z*scale.z;}mat4 getMatrixRotation(mat4 mat){mat4 m=mat4(1.0);vec3 scale=getMatrixScale(mat);m[0]=mat[0]/scale.x;m[1]=mat[1]/scale.y;m[2]=mat[2]/scale.z;return m;}void setMatrixRotation(inout mat4 mat,vec3 rotation){vec3 scale=getMatrixScale(mat);float x=rotation.x,y=rotation.y,z=rotation.z;float a=cos(x),b=sin(x);float c=cos(y),d=sin(y);float e=cos(z),f=sin(z);float ae=a*e,af=a*f,be=b*e,bf=b*f;mat[0].xyz=vec3(c*e,-c*f,d)*scale.x;mat[1].xyz=vec3(af+be*d,ae-bf*d,-b*c)*scale.y;mat[2].xyz=vec3(bf-ae*d,be+af*d,a*c)*scale.z;}void matrixCompose(inout mat4 mat,vec3 translation,vec4 quaternion,vec3 scale){float x=quaternion.x;float y=quaternion.y;float z=quaternion.z;float w=quaternion.w;float x2=x+x;float y2=y+y;float z2=z+z;float xx=x*x2;float xy=x*y2;float xz=x*z2;float yy=y*y2;float yz=y*z2;float zz=z*z2;float wx=w*x2;float wy=w*y2;float wz=w*z2;float sx=scale.x;float sy=scale.y;float sz=scale.z;mat[0]=vec4((1.0-(yy+zz))*sx,(xy+wz)*sx,(xz-wy)*sx,0.0);mat[1]=vec4((xy-wz)*sy,(1.0-(xx+zz))*sy,(yz+wx)*sy,0.0);mat[2]=vec4((xz+wy)*sz,(yz-wx)*sz,(1.0-(xx+yy))*sz,0.0);mat[3]=vec4(translation.xyz,1.0);}vec3 getViewRight(){return vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);}vec3 getViewLeft(){return-getViewRight();}vec3 getViewUp(){return vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);}vec3 getViewDown(){return-getViewUp();}vec3 getViewBack(){return vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2]);}vec3 getViewForward(){return-getViewBack();}mat4 billBoardMatrix(mat4 mat){mat4 m=mat4(1.0);vec3 scale=getMatrixScale(mat);m[0].xyz=getViewRight()*scale.x;m[1].xyz=getViewUp()*scale.y;m[2].xyz=getViewBack()*scale.z;m[3].xyz=getMatrixTranslation(mat);return m;}mat4 billboardModelMatrix(vec3 offset){mat4 m=billBoardMatrix(modelMatrix);setMatrixTranslation(m,offset);return m;}mat4 billboardModelMatrix(){return billBoardMatrix(modelMatrix);}

                varying vec2 vUv;
                flat varying vec2 vScale;

                void main() {
                    vUv = uv;
                    vScale = getMatrixScale(modelMatrix).xy;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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


                float median(sampler2D tMap,vec2 uv){vec3 tex=texture2D(tMap,uv).rgb;return max(min(tex.r,tex.g),min(max(tex.r,tex.g),tex.b))-0.5;}float msdf(sampler2D tMap,vec2 uv){float signedDist=median(tMap,uv);float d=fwidth(signedDist);return smoothstep(-d,d,signedDist);}float msdfOpaque(sampler2D tMap,vec2 uv){return step(0.0,median(tMap,uv));}float msdf(sampler2D tMap,vec2 uv,float outlineWidth){float signedDist=median(tMap,uv);float d=max(10e-6,fwidth(signedDist));return smoothstep(-d-outlineWidth,d-outlineWidth,signedDist)*smoothstep(outlineWidth+d,outlineWidth-d,signedDist);}float msdfOpaque(sampler2D tMap,vec2 uv,float outlineWidth){float signedDist=median(tMap,uv);return step(-outlineWidth,signedDist)*step(signedDist,outlineWidth);}
                vec2 imagefitUV(vec2 uv,vec2 imageSize,vec2 containerSize,float cover){vec2 st=containerSize/imageSize;float aspect=mix(min(st.x,st.y),max(st.x,st.y),cover);return(uv-0.5)*st*(1.0/aspect)+0.5;}

                uniform sampler2D tMap;
                uniform sampler2D tBlocks;
                uniform vec3 uColor;
                uniform vec3 uColor2;
                uniform float uShow;
                uniform float uRand;

                varying vec2 vUv;
                flat varying vec2 vScale;

                vec2 hash21(float p) {
                    vec3 p3 = fract(vec3(p) * vec3(.1031, .1030, .0973));
                    p3 += dot(p3, p3.yzx + 33.33);
                    return fract((p3.xx+p3.yz)*p3.zy);
                }

                void main() {
                    vec2 uv = imagefitUV(vUv, vec2(textureSize(tMap, 0)), vScale, 1.0);
                    float a = 1.0;

                    if (uShow < 1.0) {
                        // squared displacement
                        float steps = 3.0;
                        vec2 hash = hash21(floor(uShow * steps) / steps + uRand * 3.342);
                        vec2 offset = hash * 2.0 - 1.0;
                        vec2 scale = vec2(0.25, 1.0);
                        vec2 blocksUV = uv * scale + uRand * 12.4242 + offset * uRand * 4.543;
                        float blocks1 = texture2D(tBlocks, blocksUV).g * 2.0 - 1.0;
                        float displacement = 0.0075;
                        uv += vec2(blocks1, 0.0) * displacement;

                        // make it blink
                        a *= sin(uShow * 30.0 + uRand * 12.4242) * 0.15 + 0.85;
                        a *= step(0.01, uShow);

                    }

                    a *= msdf(tMap, uv);

                    gl_FragColor = vec4(uColor, a);
                }
            `;

/** Textures this program samples, with the wrap and filter the site used. */
export const textures = {
  tMap: { file: '/textures/1-t27.png', wrap: 'ClampToEdgeWrapping', minFilter: 'LinearFilter', magFilter: 'LinearFilter' }, // placeholder: your own image
  tBlocks: { file: '/textures/2-t28.png', wrap: 'RepeatWrapping', minFilter: 'LinearFilter', magFilter: 'LinearFilter' }, // placeholder: your own image
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
      tMap: { value: tex(textures.tMap) }, // placeholder 128×128: put your own image here
      tBlocks: { value: tex(textures.tBlocks) }, // placeholder 1024×1024: put your own image here
      uColor: { value: new THREE.Vector3(0, 0, 0) }, // vec3: not seen: a guess
      uColor2: { value: new THREE.Vector3(0, 0, 0) }, // vec3: not seen: a guess
      uShow: { value: 1 }, // float: not seen: a guess
      uRand: { value: 1 }, // float: not seen: a guess
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

export const meta = { name: 'MapBlocksColorShader', fullscreen: false, points: false };
