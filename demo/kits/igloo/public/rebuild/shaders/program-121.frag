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
            