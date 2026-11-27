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
#define OPAQUE

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

                uniform sampler2D tDiffuse;

                varying vec2 vUv;

                #ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp sampler3D;
#else
precision mediump sampler3D;
#endif
vec3 LUTLinearTosRGB(in vec3 value){return mix(pow(value.rgb,vec3(0.41666))*1.055-vec3(0.055),value.rgb*12.92,vec3(lessThanEqual(value.rgb,vec3(0.0031308))));}vec3 LUTsRGBToLinear(in vec3 value){return mix(pow(value.rgb*0.9478672986+vec3(0.0521327014),vec3(2.4)),value.rgb*0.0773993808,vec3(lessThanEqual(value.rgb,vec3(0.04045))));}vec3 apply3DLUT(vec3 color,sampler3D lutTexture,float lutSize,float lutIntensity){float scale=(lutSize-1.0)/lutSize;float offset=1.0/(2.0*lutSize);vec3 col=LUTLinearTosRGB(color);vec3 rgb=col*scale+offset;vec4 lutColor=texture(lutTexture,rgb);return LUTsRGBToLinear(mix(col,lutColor.rgb,lutIntensity));}vec3 apply3DLUTTetrahedral(vec3 color,sampler3D lutTexture,float lutSize,float lutIntensity){float scale=lutSize-1.0;float offset=0.0;float texelSize=1.0/lutSize;vec3 col=LUTLinearTosRGB(color);vec3 rgb=clamp(col,0.0,1.0)*scale+offset;vec3 p=floor(rgb);vec3 f=rgb-p;vec3 v1=(p+0.5)*texelSize;vec3 v4=(p+1.5)*texelSize;vec3 v2,v3;vec3 frac;if(f.r>=f.g){if(f.g>f.b){frac=f.rgb;v2=vec3(v4.x,v1.y,v1.z);v3=vec3(v4.x,v4.y,v1.z);}else if(f.r>=f.b){frac=f.rbg;v2=vec3(v4.x,v1.y,v1.z);v3=vec3(v4.x,v1.y,v4.z);}else{frac=f.brg;v2=vec3(v1.x,v1.y,v4.z);v3=vec3(v4.x,v1.y,v4.z);}}else{if(f.b>f.g){frac=f.bgr;v2=vec3(v1.x,v1.y,v4.z);v3=vec3(v1.x,v4.y,v4.z);}else if(f.r>=f.b){frac=f.grb;v2=vec3(v1.x,v4.y,v1.z);v3=vec3(v4.x,v4.y,v1.z);}else{frac=f.gbr;v2=vec3(v1.x,v4.y,v1.z);v3=vec3(v1.x,v4.y,v4.z);}}vec4 n1=texture(lutTexture,v1);vec4 n2=texture(lutTexture,v2);vec4 n3=texture(lutTexture,v3);vec4 n4=texture(lutTexture,v4);vec4 weights=vec4(1.0-frac.x,frac.x-frac.y,frac.y-frac.z,frac.z);vec4 result=weights*mat4(vec4(n1.r,n2.r,n3.r,n4.r),vec4(n1.g,n2.g,n3.g,n4.g),vec4(n1.b,n2.b,n3.b,n4.b),vec4(1.0));return LUTsRGBToLinear(mix(col,result.rgb,lutIntensity));}

                uniform sampler3D tLUT;
                uniform float uLUTSize;
                uniform float uLUTIntensity;
                uniform float uGradientAlpha;

                vec3 hash32(vec2 p) {
                    vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
                    p3 += dot(p3, p3.yxz+33.33);
                    return fract((p3.xxy+p3.yzz)*p3.zyx);
                }

                void main() {
                    vec2 uv = vUv;

                    // apply rgb shift
                    // float offset = 0.08 * length(vUv - 0.5);
                    // offset = pow(offset, 2.0);
                    // float r = texture2D(tDiffuse, uv + vec2(-offset, offset)).r;
                    // float g = texture2D(tDiffuse, uv).g;
                    // float b = texture2D(tDiffuse, uv + vec2(offset, -offset)).b;
                    // vec3 scene = vec3(r, g, b);

                    vec3 scene = texture2D(tDiffuse, uv).rgb;
                    float gradient = mix(0.8, 1.0, (uv.x + uv.y) * 0.5);
                    gradient = mix(1.0, gradient, uGradientAlpha);
                    scene *= gradient;

                    vec3 sceneColor = apply3DLUTTetrahedral(scene.rgb, tLUT, uLUTSize, uLUTIntensity);

                    // film grain
                    // vec3 noise = hash32(uv * 1000.0 + time);
                    // noise *= 2.0;
                    // noise -= 1.0;
                    // sceneColor += noise * 0.05;

                    gl_FragColor = vec4(sceneColor, 1.0);
                }
            