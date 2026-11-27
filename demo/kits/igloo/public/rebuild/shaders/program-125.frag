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


                    float median(sampler2D tMap,vec2 uv){vec3 tex=texture2D(tMap,uv).rgb;return max(min(tex.r,tex.g),min(max(tex.r,tex.g),tex.b))-0.5;}float msdf(sampler2D tMap,vec2 uv){float signedDist=median(tMap,uv);float d=fwidth(signedDist);return smoothstep(-d,d,signedDist);}float msdfOpaque(sampler2D tMap,vec2 uv){return step(0.0,median(tMap,uv));}float msdf(sampler2D tMap,vec2 uv,float outlineWidth){float signedDist=median(tMap,uv);float d=max(10e-6,fwidth(signedDist));return smoothstep(-d-outlineWidth,d-outlineWidth,signedDist)*smoothstep(outlineWidth+d,outlineWidth-d,signedDist);}float msdfOpaque(sampler2D tMap,vec2 uv,float outlineWidth){float signedDist=median(tMap,uv);return step(-outlineWidth,signedDist)*step(signedDist,outlineWidth);}
                    float efit(float x,float a1,float a2,float b1,float b2){return b1+((x-a1)*(b2-b1))/(a2-a1);}float fit(float x,float a1,float a2,float b1,float b2){return clamp(efit(x,a1,a2,b1,b2),min(b1,b2),max(b1,b2));}float fit01(float x,float a1,float a2){return fit(x,0.0,1.0,a1,a2);}float fit10(float x,float a1,float a2){return fit(x,1.0,0.0,a1,a2);}float fit11(float x,float a1,float a2){return fit(x,-1.0,1.0,a1,a2);}vec3 efit(vec3 x,vec3 a1,vec3 a2,vec3 b1,vec3 b2){return b1+((x-a1)*(b2-b1))/(a2-a1);}vec3 fit(vec3 x,vec3 a1,vec3 a2,vec3 b1,vec3 b2){return clamp(efit(x,a1,a2,b1,b2),min(b1,b2),max(b1,b2));}vec3 fit01(vec3 x,vec3 a1,vec3 a2){return fit(x,vec3(0.0),vec3(1.0),a1,a2);}vec3 fit10(vec3 x,vec3 a1,vec3 a2){return fit(x,vec3(1.0),vec3(0.0),a1,a2);}vec3 fit11(vec3 x,vec3 a1,vec3 a2){return fit(x,vec3(-1.0),vec3(1.0),a1,a2);}
                    float _linstep(float begin,float end,float t){return clamp((t-begin)/(end-begin),0.0,1.0);}float _pl(vec2 _input,vec2 start,vec2 end,float margin,float progress){vec2 v=end-start;float dist=length(v);vec2 dir=v/dist;return dot(dir,_input-start-dir*(dist+margin)*progress);}float _pl(vec3 _input,vec3 start,vec3 end,float margin,float progress){vec3 v=end-start;float dist=length(v);vec3 dir=v/dist;return dot(dir,_input-start-dir*(dist+margin)*progress);}float falloff(float _input,float start,float end,float margin,float progress){float m=margin*sign(end-start);float p=mix(start-m,end,progress);return _linstep(p+m,p,_input);}float falloffsmooth(float _input,float start,float end,float margin,float progress){float m=margin*sign(end-start);float p=mix(start-m,end,progress);return smoothstep(p+m,p,_input);}float falloff(vec2 _input,vec2 start,vec2 end,float margin,float progress){return _linstep(0.0,-margin,_pl(_input,start,end,margin,progress));}float falloffsmooth(vec2 _input,vec2 start,vec2 end,float margin,float progress){return smoothstep(0.0,-margin,_pl(_input,start,end,margin,progress));}float falloff(vec3 _input,vec3 start,vec3 end,float margin,float progress){return _linstep(0.0,-margin,_pl(_input,start,end,margin,progress));}float falloffsmooth(vec3 _input,vec3 start,vec3 end,float margin,float progress){return smoothstep(0.0,-margin,_pl(_input,start,end,margin,progress));}

                    uniform sampler2D tMap;
                    uniform vec3 uColor;

                    varying vec2 vUv;
                    varying float vAlpha;

                    void main() {
                        vec2 uv = vUv;
                        float alpha = vAlpha;
                        alpha *= msdf(tMap, uv);
                        gl_FragColor = vec4(uColor, alpha);
                    }
                