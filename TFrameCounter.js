
function TFrameCounter(CounterName,LapTimeMs=1000)
{
	this.LastLapTime = null;
	this.Count = 0;
	this.CounterName = CounterName;

	this.Report = function(CountPerSec)
	{
		Pop.Debug( CounterName + " " + CountPerSec.toFixed(2) + "/sec");
	}

	this.OnLap = function()
	{
		let TimeElapsed = Pop.GetTimeNowMs() - this.LastLapTime;
		let Scalar = TimeElapsed / LapTimeMs;
		let CountPerSec = this.Count / Scalar;
		this.Report( CountPerSec );
		this.LastLapTime = Pop.GetTimeNowMs();
		this.Count = 0;
	}
	
	this.Add = function(Increment=1)
	{
		this.Count += Increment;
		
		if ( this.LastLapTime === null )
			this.LastLapTime = Pop.GetTimeNowMs();
		
		let TimeElapsed = Pop.GetTimeNowMs() - this.LastLapTime;
		if ( TimeElapsed > LapTimeMs )
		{
			this.OnLap();
		}
	}
}
