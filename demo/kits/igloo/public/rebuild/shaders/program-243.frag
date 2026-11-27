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


                    uniform Global{vec2 resolution;vec2 resolutionUI;float aspect;float time;float dtRatio;};
                    float aastep(float threshold,float value){float afwidth=length(vec2(dFdx(value),dFdy(value)))*0.70710678118654757;return smoothstep(threshold-afwidth,threshold+afwidth,value);}
                    vec2 encodeNormal(vec3 n){n/=(abs(n.x)+abs(n.y)+abs(n.z));return(n.z>=0.0)? n.xy :(1.0-abs(n.yx))*sign(n.xy);}vec3 decodeNormal(vec2 f){vec3 n=vec3(f,1.0-abs(f.x)-abs(f.y));float t=max(-n.z,0.0);n.x+=(n.x>0.0)?-t : t;n.y+=(n.y>0.0)?-t : t;return normalize(n);}vec2 encodeNormalUint8(vec3 n){return encodeNormal(n)*0.5+0.5;}vec3 deodeNormalUint8(vec2 n){return decodeNormal(n*2.0-1.0);}vec2 encodeNormalSpheremap(vec3 n){float f=sqrt(8.0*n.z+8.0);return n.xy/f*2.0;}vec3 decodeNormalSpheremap(vec2 n){vec4 nn=vec4(n.xy,1.0,-1.0);float l=dot(nn.xyz,-nn.xyw);nn.z=l;nn.xy*=sqrt(l);return nn.xyz*2.0+vec3(0.0,0.0,-1.0);}vec2 encodeNormalSpheremapUint8(vec3 n){return encodeNormalSpheremap(n)*0.5+0.5;}vec3 deodeNormalSimpleUint8(vec2 n){return decodeNormalSpheremap(n*2.0-1.0);}
                    float _linstep(float begin,float end,float t){return clamp((t-begin)/(end-begin),0.0,1.0);}float _pl(vec2 _input,vec2 start,vec2 end,float margin,float progress){vec2 v=end-start;float dist=length(v);vec2 dir=v/dist;return dot(dir,_input-start-dir*(dist+margin)*progress);}float _pl(vec3 _input,vec3 start,vec3 end,float margin,float progress){vec3 v=end-start;float dist=length(v);vec3 dir=v/dist;return dot(dir,_input-start-dir*(dist+margin)*progress);}float falloff(float _input,float start,float end,float margin,float progress){float m=margin*sign(end-start);float p=mix(start-m,end,progress);return _linstep(p+m,p,_input);}float falloffsmooth(float _input,float start,float end,float margin,float progress){float m=margin*sign(end-start);float p=mix(start-m,end,progress);return smoothstep(p+m,p,_input);}float falloff(vec2 _input,vec2 start,vec2 end,float margin,float progress){return _linstep(0.0,-margin,_pl(_input,start,end,margin,progress));}float falloffsmooth(vec2 _input,vec2 start,vec2 end,float margin,float progress){return smoothstep(0.0,-margin,_pl(_input,start,end,margin,progress));}float falloff(vec3 _input,vec3 start,vec3 end,float margin,float progress){return _linstep(0.0,-margin,_pl(_input,start,end,margin,progress));}float falloffsmooth(vec3 _input,vec3 start,vec3 end,float margin,float progress){return smoothstep(0.0,-margin,_pl(_input,start,end,margin,progress));}

                    uniform float uAlpha;

                    varying vec2 vUv;
                    varying vec3 vPos;
                    varying vec4 vMvPos;
                    varying float vAlpha;

                    void main() {
                        float value = 1.0 - min(10.0, length(vPos)) / 10.0;
                        vec3 color = vec3(mix(0.75, 1.0, value));
                        float alpha = 1.0;

                        // fade near bounds
                        vec3 bounds = vec3(25.0, 10.0, 25.0);
                        alpha *= 1.0 - min(bounds.x, abs(vPos.x)) / bounds.x;
                        alpha *= 1.0 - min(bounds.y, abs(vPos.y)) / bounds.y;
                        alpha *= 1.0 - min(bounds.z, abs(vPos.z)) / bounds.z;

                        // fade near camera
                        alpha *= smoothstep(length(vMvPos), 0.5, 1.0);

                        // fade near ground
                        alpha *= smoothstep(0.0, 2.0, vPos.y);

                        // fade near igloo
                        alpha *= smoothstep(0.5, 1.0, min(6.0, length(vPos)) / 6.0);

                        // shape
                        float circularGrad = 1.0 - length(vUv - 0.5) * 2.0;
                        alpha *= circularGrad;

                        alpha *= uAlpha;
                        alpha = clamp(alpha, 0.0, 1.0);

                        gl_FragColor = vec4(color, alpha);
                    }
                