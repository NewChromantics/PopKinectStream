Pop.Include = function(Filename)
{
	const Source = Pop.LoadFileAsString(Filename);
	return Pop.CompileAndRun( Source, Filename );
}


let VertShader = Pop.LoadFileAsString('Quad.vert.glsl');
let Blit_Kinect_Shader = Pop.LoadFileAsString('BlitKinect8.frag.glsl');
let Blit_Yuv8_8_8Shader = Pop.LoadFileAsString('Blit_Yuv8_8_8.frag.glsl');

Pop.Include('TFrameCounter.js');
Pop.Include('StreamEncoder.js');
Pop.Include('PopShaderCache.js');

Pop.CreateColourTexture = function(Colour4)
{
	let NewTexture = new Pop.Image();
	NewTexture.WritePixels( 1, 1, Colour4 );
	return NewTexture;
}


let Shaders = [];
let InputCounter = new TFrameCounter("Kinect input");
let EncodeCounter = new TFrameCounter("H264 encodes");
let H264ByteCounter = new TFrameCounter("H264 bytes");
let RenderCounter = new TFrameCounter("Render");

//	allow no rendering for the weaker machines
var EnableRender = true;

var WebsocketServer = null;

var Params = {};
Params.DepthMin = 500;
Params.DepthMax = 4500;
Params.PixelNear = 5; 
Params.PixelFar = 247; 

Math.clamp = function(min, max,Value)
{
	return Math.min( Math.max(Value, min), max);
}

Math.lerp = function(min, max, Time)
{
	return min + ( (max-min) * Time );
}

Math.range = function(Min,Max,Value)
{
	return (Value-Min) / (Max-Min);
}

Math.rangeClamped = function(Min,Max,Value)
{
	return Math.clamp( 0, 1, Math.range( Min, Max, Value ) );
}



H264ByteCounter.Report = function(CountPerSec)
{
	let KbSec = CountPerSec / 1024;
	Pop.Debug( this.CounterName + " " + KbSec.toFixed(2) + "kb/sec");
}

function RenderDepth(RenderTarget)
{
	if ( !EnableRender )
	{
		//RenderTarget.Clear(0,255,255);
		return;
	}

	const InputImage = this.InputImage;
	const OutputImage = this.OutputImage;


	const ShaderSource = InputImage.GetFormat() == 'Greyscale' ? Blit_Kinect_Shader : Blit_Yuv8_8_8Shader;
	const FragShader = Pop.GetShader(RenderTarget,ShaderSource);
	//Pop.Debug(InputImage.GetFormat());
	const DrawLeft_SetUniforms = function(Shader)
	{
		Shader.SetUniform("VertexRect", [0,0,0.5,1] );
		Shader.SetUniform("Texture", InputImage );
		Shader.SetUniform("Yuv_8_8_8_Texture", InputImage );
		Shader.SetUniform("NearMax", Params.PixelNear );
		Shader.SetUniform("FarMin", Params.PixelFar );
	}
	RenderTarget.DrawQuad( FragShader, DrawLeft_SetUniforms );

	const DrawRight_SetUniforms = function(Shader)
	{
		Shader.SetUniform("VertexRect", [0.5,0,0.5,1] );
		Shader.SetUniform("Texture", OutputImage );
		Shader.SetUniform("Yuv_8_8_8_Texture", OutputImage );
		Shader.SetUniform("NearMax", Params.PixelNear );
		Shader.SetUniform("FarMin", Params.PixelFar );
	}
	RenderTarget.DrawQuad( FragShader, DrawRight_SetUniforms );

	RenderCounter.Add(1);
}

function GetKinect8Bit(Depth16Image,Depth8Image)
{
	//Pop.Debug(Depth16Image.GetFormat(),Depth16Image.GetWidth(),Depth16Image.GeHeight());
	if ( Depth16Image.GetFormat() != 'KinectDepth' && Depth16Image.GetFormat() != 'FreenectDepthmm' )
		throw "Expected KinectDepth, but format is " + Depth16Image.GetFormat();

	const w = Depth16Image.GetWidth();
	const h = Depth16Image.GetHeight();
	const Depth16 = Depth16Image.GetPixelBuffer();
	const Depth8 = new Uint8Array( w*h );

	for ( let i=0;	i<Depth16.length;	i++ )
	{
		let Depth = Depth16[i];

		//	normalise
		let Depthf = Math.rangeClamped( Params.DepthMin, Params.DepthMax, Depth );
		//Pop.Debug(Depthf);
		Depth = Math.floor( Depthf * 255 );

		Depth8[i] = Depth;
	}

	if ( !Depth8Image )
		Depth8Image = new Pop.Image();
	Depth8Image.WritePixels( w, h, Depth8, 'Greyscale' );
	return Depth8Image;
}

let FirstPackets = [];
let PeerInitialised = [];
function BroadcastH264Packet(Packet)
{
	//	need to buffer up packets here so SPS & PPS get sent
	//	we should grab an initial set of header packets for new connections
	if ( !WebsocketServer )
		return;

	//	buffer up initial packets first (to make code simpler)
	//	todo: store SPS/PPS only, and then the last keyframe
	if ( FirstPackets.length < 10 )
	{
		FirstPackets.push(Packet);
		return;
	}

	let SendPacket = function(Peer,NextPacket)
	{
		//Pop.Debug("Time=", JSON.stringify(NextPacket.Time));
		//Pop.Debug("Meta=", JSON.stringify(NextPacket.Meta));
		//Pop.Debug("Data=x", NextPacket.Data.length );
		if ( NextPacket.Meta !== undefined )
			WebsocketServer.Send( Peer, JSON.stringify(NextPacket.Meta) );
		WebsocketServer.Send( Peer, NextPacket.Data );
	}

	let SendToPeer = function(Peer)
	{
		//	if this is a new peer, send the first packets first
		if ( PeerInitialised[Peer] !== true )
		{
			FirstPackets.forEach( p => SendPacket( Peer, p ) );
			PeerInitialised[Peer] = true;
		}		

		SendPacket( Peer, Packet );
	}
	let Peers = WebsocketServer.GetPeers();
	Peers.forEach( SendToPeer );
}

async function ProcessEncoding(Encoder,OnOutputImageChanged)
{
	const Decoder = new Pop.Media.AvcDecoder();

	//	encode, decode, encode, decode etc
	while ( true )
	{
		const Packet = await Encoder.GetNextPacket();
		if ( !Packet )
			continue;

		EncodeCounter.Add(1);
		H264ByteCounter.Add(Packet.Data.length);
		const Meta = Encoder.Metas[Packet.Time];
		//Pop.Debug("Packet.Time",Packet.Time);
		//EncodeMetas.splice(Packet.Time, 1);
		//	delete when popped so meta only sent for first packet
		delete Encoder.Metas[Packet.Time];
		//Pop.Debug( Object.keys(EncodeMetas) );
		Packet.Meta = Meta;
	
		//	send packet over network
		try
		{
			BroadcastH264Packet( Packet );
		}
		catch(e)
		{
			Pop.Debug("BroadcastH264Packet Error",e);
		}

		//	decode to screen to debug
		const ExtractPlanes = false;
		const Frames = await Decoder.Decode(Packet.Data,ExtractPlanes);
		//Pop.Debug(JSON.stringify(Frames));
		if ( Frames.length == 0 )
			continue;

		//Pop.Debug("Frames",Frames);
		//Pop.Debug(Frames.length);
		const Frame = Frames[0].Planes[0];
		if ( Frame )
		{
			//Pop.Debug("Output frame",Frame.GetFormat());
			OnOutputImageChanged(Frame);
		}		
	}
}

async function ProcessKinectFrames(CameraSource,Encoder,FramePostProcess,OnInputImageChanged,OnFirstMeta)
{
	const FrameBuffer = new Pop.Image();
	const Depth8 = new Pop.Image();
	let FrameTime = 0;
	let FirstFrame = true;
	
	//const FrameBuffer = undefined;
	while ( true )
	{
		try
		{
			await Pop.Yield(0);
			const fb = FrameBuffer;
			const Stream = 0;
			const Latest = true;
			const NextFrame = await CameraSource.GetNextFrame( fb, Stream, Latest );
			if ( !NextFrame )
				continue;
			
			//Pop.Debug("Meta", JSON.stringify(NextFrame.Meta) );

			const Meta = NextFrame.Meta || {};
			
			if ( FirstFrame )
			{
				OnFirstMeta( Meta );
				FirstFrame = false;
			}
			
			InputCounter.Add(1);

			//	convert from kinect to something we can send			
			const YuvFrame = FramePostProcess(fb,Depth8);
			OnInputImageChanged(YuvFrame);

			//	add some extra meta
			Meta.FrameIndex = FrameTime;
			Meta.DepthMin = Params.DepthMin;
			Meta.DepthMax = Params.DepthMax;
			

			Encoder.Metas[FrameTime] = Meta;
			Encoder.Encode( YuvFrame, FrameTime );
			FrameTime++;
		}
		catch(e)
		{
			//	sometimes OnFrameExtracted gets triggered, but there's no frame? (usually first few on some cameras)
			//	so that gets passed up here. catch it, but make sure we re-request
			if ( e != "No frame packet buffered" )
				Pop.Debug(e);
		}
	}
}





function CreateParamsWindow(Params,OnAnyChanged)
{
	OnAnyChanged = OnAnyChanged || function(){};
	
	let WindowRect = [20,20,500,300];
	let ControlTop = 10;

	const LabelLeft = 10;
	const LabelWidth = 120;
	const LabelHeight = 28;
	const ControlLeft = LabelLeft + LabelWidth + 10;
	const ControlWidth = WindowRect[2] - ControlLeft - 40;
	const ControlHeight = LabelHeight;
	const ControlSpacing = 10;

	let Window = new Pop.Gui.Window("Params",WindowRect,false);
	Window.EnableScrollbars(false,true);
	Window.Controls = [];
	Window.Labels = [];
	
	Window.OnParamChanged = function(Name)
	{
		if ( !this.Controls.hasOwnProperty(Name) )
		{
			Pop.Debug("Tried to change param " + Name + " but no control assigned");
			return;
		}
		
		let Control = this.Controls[Name];
		let Value = Params[Name];
		Pop.Debug("Updating control", JSON.stringify(Control), Value );
		Control.SetValue( Value );
		Control.OnChanged( Value );
	}

	let AddSlider = function(Name,Min,Max,CleanValue)
	{
		if ( !CleanValue )
			CleanValue = function(v)	{	return v;	}
			
		let LabelTop = ControlTop;
		let Label = new Pop.Gui.Label( Window, [LabelLeft,LabelTop,LabelWidth,LabelHeight] );
		
		let Control;
		if ( typeof Params[Name] === 'boolean' )
		{
			Control = new Pop.Gui.TickBox( Window, [ControlLeft,ControlTop,ControlWidth,ControlHeight] );
			Control.SetValue( Params[Name] );
			
			Control.OnChanged = function(Value)
			{
				Value = CleanValue(Value);
				Params[Name] = Value;
				Label.SetValue( Name + ": " + Value );
				OnAnyChanged(Params);
			}
			
			//	init label
			Control.OnChanged( Params[Name] );
		}
		else
		{
			const TickScalar = (CleanValue===Math.floor) ? Max : 1000;
			const Notches = (CleanValue===Math.floor) ? Max : false;
			let Slider = new Pop.Gui.Slider( Window, [ControlLeft,ControlTop,ControlWidth,ControlHeight], Notches );
			Slider.SetMinMax( 0, TickScalar );
			let Valuef = Math.range( Min, Max, Params[Name] );
			let Valuek = Valuef * TickScalar;
			Slider.SetValue( Valuek );
			
			Slider.OnChanged = function(Valuek)
			{
				let Valuef = Valuek/TickScalar;
				let Value = Math.lerp( Min, Max, Valuef );
				Value = CleanValue(Value);
				Params[Name] = Value;
				Label.SetValue( Name + ": " + Value );
				
				OnAnyChanged(Params);
			}
			
			//	init label
			Slider.OnChanged( Valuek );
			Control = Slider;
		}
		
		ControlTop += ControlHeight;
		ControlTop += ControlSpacing;
		
		
		//	save objects
		Window.Controls[Name] = Control;
		Window.Labels[Name] = Label;
	}

	
	
	AddSlider('DepthMin',0,16000,Math.floor);
	AddSlider('DepthMax',0,16000,Math.floor);
	AddSlider('PixelNear',0,255,Math.floor);
	AddSlider('PixelFar',0,255,Math.floor);
	
	return Window;
}

function SaveParams(Params)
{
	//
}

//	make params editor
const ParamsEditor = CreateParamsWindow(Params,SaveParams);

//	gr: this shoulod be async in case we have trouble creating ports
function CreateWebsocketServer(Ports)
{
	let Try = 0;
	while(true)
	{
		let Port = Ports[Try%Ports.length];
		Try++;
		try
		{
			let Server = new Pop.Websocket.Server(Port);
			Pop.Debug("Created websocket server at " + JSON.stringify(Server.GetAddress()) );
			return Server;
		}
		catch(Exception)
		{
			Pop.Debug("Creating websocket on " + Port + " failed; " + Exception);
			//	todo: sleep here!
		}
	}
}

const BroadcastServer = new UdpBroadcastServer(9999);
const WebsocketPorts = [8888,8887,8886,8885,8884,8883];
WebsocketServer = CreateWebsocketServer(WebsocketPorts);

function GetBroadcastMessage()
{
	let AddressObject = {};
	AddressObject.Addresses = [];
	let AddrInfo = WebsocketServer.GetAddress();

	let PushAddress = function(Addr)
	{
		let Address = Addr.Address;
		//	ignore local/incomplete ip's
		if ( Address.startsWith('localhost') )	return;
		if ( Address.startsWith('127.0.0.1') )	return;
		if ( Address.startsWith('169.254.') )	return;	//	unconfigured/no dhcp device
		AddressObject.Addresses.push( Address );
	}

	AddrInfo.forEach( PushAddress);
	let MessageOut = JSON.stringify(AddressObject);
	return MessageOut;
}
Pop.Debug("GetBroadcastMessage",GetBroadcastMessage());

BroadcastServer.OnMessage = function(MessageIn,Sender)
{
	let MessageOut = GetBroadcastMessage();
	BroadcastServer.Send( Sender, MessageOut );
}



let MemCheckLoop = async function()
{
	while(true)
	{
		try
		{
			await Pop.Yield(1000);
			Pop.GarbageCollect();
		
			let Debug = "Memory: ";
			
			const ImageHeapSize = (Pop.GetImageHeapSize() / 1024 / 1024).toFixed(2) + "mb";
			const ImageHeapCount = Pop.GetImageHeapCount();
			Debug += " ImageHeapSize="+ImageHeapSize+" x" + ImageHeapCount;
			
			const GeneralHeapSize = (Pop.GetHeapSize() / 1024 / 1024).toFixed(2) + "mb";
			const GeneralHeapCount = Pop.GetHeapCount();
			Debug += " GeneralHeapSize="+GeneralHeapSize+" x" + GeneralHeapCount;
			
			Debug += JSON.stringify(Pop.GetHeapObjects());
			Pop.Debug(Debug);
			Debug = null;
		}
		catch(e)
		{
			Pop.Debug("Loop Error: " + e );
		}
	}
}
//MemCheckLoop();

function OnError(Error)
{
	Pop.Debug("Error",Error);
}



function ProcessColourFrame(Frame,OutputBuffer)
{
	//	YYuv_8888_Full to Yuv_8_8_8_Ntsc
	if ( Frame.GetFormat() == 'YYuv_8888_Full' )
	{
		const yyuv = Frame.GetPixelBuffer();
		let w = Frame.GetWidth();
		let h = Frame.GetHeight();
		let LumaSize = w*h;
		let ChromaSize = (w/2)*(h/2);
		let yuv_8_8_8 = new Uint8Array( LumaSize + ChromaSize + ChromaSize );
		for ( let p=0;	p<yyuv.length/4;	p++ )
		{
			let Luma0 = yyuv[(p*4)+0];
			let ChromaU = yyuv[(p*4)+1];
			let Luma1 = yyuv[(p*4)+2];
			let ChromaV = yyuv[(p*4)+3];

			yuv_8_8_8[ (p*2)+0 ] = Luma0;
			yuv_8_8_8[ (p*2)+1 ] = Luma1;
			yuv_8_8_8[ LumaSize+p ] = ChromaU;
			yuv_8_8_8[ LumaSize+ChromaSize+p ] = ChromaV;
		}
		if ( !OutputBuffer )
			OutputBuffer = new Pop.Image();
		OutputBuffer.WritePixels( Frame.GetWidth(), Frame.GetHeight(), yuv_8_8_8, 'Yuv_8_8_8_Ntsc' );
		return OutputBuffer;
	}


	return Frame;
}

Pop.Media.EnumDevices().then( Devices => Pop.Debug("Devices:",Devices) ).catch(OnError);

function OnDepthMeta(Meta)
{
	Pop.Debug("Depthmeta!",JSON.stringify(Meta));
	
	let Min = undefined;
	let Max = Meta.DepthMax;

	if ( Min !== undefined )
	{
		Params.DepthMin = Min;
		ParamsEditor.OnParamChanged('DepthMin');
	}
	
	if ( Max !== undefined )
	{
		Params.DepthMax = Max;
		ParamsEditor.OnParamChanged('DepthMax');
	}
}

//let DepthStream = new TStreamEncoder("Kinect2:Default_Depth","Depth",GetKinect8Bit,RenderDepth,OnDepthMeta,OnError);
let DepthStream = new TStreamEncoder("Freenect:A22595W00862214A_Depth","Depth",GetKinect8Bit,RenderDepth,OnDepthMeta,OnError);
//let ColourStream = new TStreamEncoder("Kinect V2 Video Sensor","Colour",ProcessColourFrame,RenderDepth,undefined,OnError);
//let ColourStream = new TStreamEncoder("Display iSight","Colour",ProcessColourFrame,RenderDepth,undefined,OnError);

