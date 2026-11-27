#version 300 es
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
                float aastep(float threshold,float value){float afwidth=length(vec2(dFdx(value),dFdy(value)))*0.70710678118654757;return smoothstep(threshold-afwidth,threshold+afwidth,value);}
                vec2 rotateUV(vec2 uv,float rotation,vec2 mid){float c=cos(rotation);float s=sin(rotation);return vec2(c*(uv.x-mid.x)+s*(uv.y-mid.y)+mid.x,c*(uv.y-mid.y)-s*(uv.x-mid.x)+mid.y);}vec2 rotateUV(vec2 uv,float rotation,float mid){return rotateUV(uv,rotation,vec2(mid));}vec2 rotateUV(vec2 uv,float rotation){return rotateUV(uv,rotation,vec2(0.5));}vec2 scaleUV(vec2 uv,float scale,vec2 mid){uv-=mid;uv*=1.0/scale;uv+=mid;return uv;}vec2 scaleUV(vec2 uv,float scale,float mid){return scaleUV(uv,scale,vec2(mid));}vec2 scaleUV(vec2 uv,float scale){return scaleUV(uv,scale,vec2(0.5));}

                uniform vec3 uColor;

                flat varying float vProgress;

                void main() {
                    if (vProgress < 0.001) discard;
                    vec2 uv = rotateUV(gl_PointCoord.xy, mix(1.3, 0.0, vProgress));
                    uv = uv * 2.0 - 1.0;

                    const float size = 0.125;
                    float shape = 1.0 - aastep(size, abs(uv.x)) * aastep(size, abs(uv.y));

                    gl_FragColor = vec4(uColor, shape * 0.5);
                }
            