precision highp float;
varying vec2 uv;

uniform sampler2D Texture;
uniform bool Mirror = false;
const float4 NearColour = float4( 0,0,0,1 );
const float4 FarColour = float4( 0,0,1,1 );
uniform int NearMax = 0;
uniform int FarMin = 255;

#define NearMaxf	( float(NearMax) / 255.0 )
#define FarMinf		( float(FarMin) / 255.0 )


float3 NormalToRedGreen(float Normal)
{
	if ( Normal < 0.5 )
	{
		Normal = Normal / 0.5;
		return float3( 1, Normal, 0 );
	}
	else if ( Normal <= 1 )
	{
		Normal = (Normal-0.5) / 0.5;
		return float3( 1-Normal, 1, 0 );
	}
	
	//	>1
	return float3( 0,0,1 );
}


void main()
{
	float2 Sampleuv = uv;
	if ( Mirror )
		Sampleuv.x = 1.0 - Sampleuv.x;
	
	float Sample = texture2D( Texture, Sampleuv ).x;

	gl_FragColor.w = 1;
	
	if ( Sample <= NearMaxf )
		gl_FragColor = NearColour;
	else if ( Sample >= FarMinf )
		gl_FragColor = FarColour;
	else
		gl_FragColor.xyz = NormalToRedGreen(Sample);
}


