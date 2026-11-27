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
                float _linstep(float begin,float end,float t){return clamp((t-begin)/(end-begin),0.0,1.0);}float _pl(vec2 _input,vec2 start,vec2 end,float margin,float progress){vec2 v=end-start;float dist=length(v);vec2 dir=v/dist;return dot(dir,_input-start-dir*(dist+margin)*progress);}float _pl(vec3 _input,vec3 start,vec3 end,float margin,float progress){vec3 v=end-start;float dist=length(v);vec3 dir=v/dist;return dot(dir,_input-start-dir*(dist+margin)*progress);}float falloff(float _input,float start,float end,float margin,float progress){float m=margin*sign(end-start);float p=mix(start-m,end,progress);return _linstep(p+m,p,_input);}float falloffsmooth(float _input,float start,float end,float margin,float progress){float m=margin*sign(end-start);float p=mix(start-m,end,progress);return smoothstep(p+m,p,_input);}float falloff(vec2 _input,vec2 start,vec2 end,float margin,float progress){return _linstep(0.0,-margin,_pl(_input,start,end,margin,progress));}float falloffsmooth(vec2 _input,vec2 start,vec2 end,float margin,float progress){return smoothstep(0.0,-margin,_pl(_input,start,end,margin,progress));}float falloff(vec3 _input,vec3 start,vec3 end,float margin,float progress){return _linstep(0.0,-margin,_pl(_input,start,end,margin,progress));}float falloffsmooth(vec3 _input,vec3 start,vec3 end,float margin,float progress){return smoothstep(0.0,-margin,_pl(_input,start,end,margin,progress));}

                varying vec3 vWorldPos;

                uniform sampler2D tNumbers;

                uniform float uProgress;
                uniform float uAlpha;

                void main() {
                    // scale uvs to match a single character of the spritesheet
                    vec2 uv = gl_PointCoord.xy;
                    uv.y = 1.0 - uv.y;
                    uv.y /= 32.0;
                    uv.y += 1.0 / 32.0;

                    // animate spritesheet character offset
                    float offset = length(vWorldPos);
                    float progress = uProgress * 4.0;
                    progress = floor(progress * 12.0 - offset) / 32.0;
                    progress = clamp(progress, 0.0, 1.0);
                    uv.y += progress;

                    // sample numbers texture with offset uvs
                    float numbers = texture2D(tNumbers, uv).r;
                    float alpha = 1.0;

                    // intro animation
                    float gradientInput = length(vWorldPos);
                    float shockwave = falloff(gradientInput, 0.0, 20.0, 5.0, uProgress);
                    alpha *= shockwave;

                    vec3 color = vec3(numbers);
                    alpha *= 0.5;

                    gl_FragColor = vec4(color, alpha);
                }
            