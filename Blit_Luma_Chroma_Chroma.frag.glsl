precision highp float;
varying vec2 uv;

uniform sampler2D ChromaUTexture;
uniform sampler2D ChromaVTexture;
uniform sampler2D LumaTexture;


float Range(float Min,float Max,float Value)
{
	return (Value-Min) / (Max-Min);
}

const float ChromaVRed = 1.5958;
const float ChromaUGreen = -0.39173;
const float ChromaVGreen = -0.81290;
const float ChromaUBlue = 2.017;

float3 LumaChromaToRgb(float Luma,float2 Chroma)
{
	//	0..1 to -0.5..0.5
	Luma = mix( 16.0/255.0, 253.0/255.0, Luma );
	Chroma -= 0.5;
	
	float3 Rgb;
	Rgb.x = Luma + (ChromaVRed * Chroma.y);
	Rgb.y = Luma + (ChromaUGreen * Chroma.x) + (ChromaVGreen * Chroma.y);
	Rgb.z = Luma + (ChromaUBlue * Chroma.x);
	
	Rgb = max( float3(0,0,0), Rgb );
	Rgb = min( float3(1,1,1), Rgb );
	
	return Rgb;
}

void main()
{
	float Luma = texture2D( LumaTexture, uv ).x;
	
	float ChromaU = texture2D( ChromaUTexture, uv ).x;
	float ChromaV = texture2D( ChromaVTexture, uv ).x;
	float3 Rgb = LumaChromaToRgb( Luma, float2(ChromaU,ChromaV) );
	
	gl_FragColor = float4( Rgb, 1 );
}


